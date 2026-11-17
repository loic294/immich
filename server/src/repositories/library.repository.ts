import { Injectable } from '@nestjs/common';
import { sql, type Insertable, type Kysely, type Selectable, type Updateable } from 'kysely';
import { basename } from 'node:path';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { SystemConfig } from 'src/dtos/config.dto.js';
import { LibraryStatsResponseDto } from 'src/dtos/library.dto.js';
import { AlbumUserRole, AssetFileType, AssetType, AssetVisibility, ChecksumAlgorithm } from 'src/enum.js';
import { DB } from 'src/schema/index.js';
import { LibraryTable } from 'src/schema/tables/library.table.js';

export enum AssetSyncResult {
  DO_NOTHING,
  UPDATE,
  OFFLINE,
  CHECK_OFFLINE,
}

type MoveLibrary = Pick<Selectable<LibraryTable>, 'id' | 'ownerId' | 'importPaths' | 'exclusionPatterns'>;
type MoveAssetOptions = {
  sourceLibrary: MoveLibrary;
  destinationLibrary: MoveLibrary;
  sourcePath: string;
  destinationPath: string;
  assetId?: string;
  checksum: Buffer;
  fileModifiedAt: Date;
  experimental: SystemConfig['library']['experimental'];
};
type MoveAssetResult =
  | { assetId: string; people: { ownerId: string; personGroupId: string }[] }
  | { error: string };

@Injectable()
export class LibraryRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID] })
  get(id: string, withDeleted = false) {
    return this.db
      .selectFrom('library')
      .selectAll('library')
      .where('library.id', '=', id)
      .$if(!withDeleted, (qb) => qb.where('library.deletedAt', 'is', null))
      .executeTakeFirst();
  }

  @GenerateSql({ params: [] })
  getAll(withDeleted = false) {
    return this.db
      .selectFrom('library')
      .selectAll('library')
      .orderBy('createdAt', 'asc')
      .$if(!withDeleted, (qb) => qb.where('library.deletedAt', 'is', null))
      .execute();
  }

  @GenerateSql()
  getAllDeleted() {
    return this.db
      .selectFrom('library')
      .selectAll('library')
      .where('library.deletedAt', 'is not', null)
      .orderBy('createdAt', 'asc')
      .execute();
  }

  create(library: Insertable<LibraryTable>) {
    return this.db.insertInto('library').values(library).returningAll().executeTakeFirstOrThrow();
  }

  async delete(id: string) {
    await this.db.deleteFrom('library').where('library.id', '=', id).execute();
  }

  async softDelete(id: string) {
    await this.db.updateTable('library').set({ deletedAt: new Date() }).where('library.id', '=', id).execute();
  }

  update(id: string, library: Updateable<LibraryTable>) {
    return this.db
      .updateTable('library')
      .set(library)
      .where('library.id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  moveAsset(options: MoveAssetOptions): Promise<MoveAssetResult> {
    const { sourceLibrary, destinationLibrary, sourcePath, destinationPath, experimental } = options;
    return this.db.transaction().execute(async (tx): Promise<MoveAssetResult> => {
      const libraries = await tx.selectFrom('library').selectAll()
        .where('id', 'in', [sourceLibrary.id, destinationLibrary.id]).orderBy('id').forUpdate().execute();
      for (const expected of [sourceLibrary, destinationLibrary]) {
        const current = libraries.find(({ id }) => id === expected.id);
        if (!current || current.deletedAt || current.ownerId !== expected.ownerId ||
          JSON.stringify(current.importPaths) !== JSON.stringify(expected.importPaths) ||
          JSON.stringify(current.exclusionPatterns) !== JSON.stringify(expected.exclusionPatterns)) {
          return { error: 'Library settings changed during the move; retry after verifying both libraries' };
        }
      }
      const assets = await tx.selectFrom('asset').selectAll().where((eb) => eb.or([
        eb.and([eb('libraryId', '=', sourceLibrary.id), eb('originalPath', '=', sourcePath)]),
        eb.and([eb('libraryId', '=', destinationLibrary.id), eb('originalPath', '=', destinationPath)]),
      ])).orderBy('id').forUpdate().execute();
      const source = assets.find((asset) => asset.libraryId === sourceLibrary.id && asset.originalPath === sourcePath);
      const destination = assets.find((asset) =>
        asset.libraryId === destinationLibrary.id && asset.originalPath === destinationPath);
      if (!source) {
        if (destination && options.assetId === destination.id && destination.ownerId === destinationLibrary.ownerId) {
          const people = await tx.selectFrom('person').innerJoin('asset_face', 'asset_face.personGroupId', 'person.personGroupId')
            .select(['person.ownerId', 'person.personGroupId']).distinct()
            .where('person.ownerId', '=', destinationLibrary.ownerId).where('asset_face.assetId', '=', destination.id)
            .where('person.thumbnailPath', '=', '').execute();
          return { assetId: destination.id, people };
        }
        return { error: 'Source asset not found; supply the original assetId to retry a completed move safely' };
      }
      if (destination || (options.assetId && options.assetId !== source.id)) {
        return { error: 'Destination already has an asset or the source asset ID changed; no assets were removed' };
      }
      if (!source.isExternal || source.ownerId !== sourceLibrary.ownerId) {
        return { error: 'Source asset no longer belongs to the expected external library owner' };
      }

      const ownershipChanged = sourceLibrary.ownerId !== destinationLibrary.ownerId;
      const people: { ownerId: string; personGroupId: string }[] = [];
      if (ownershipChanged) {
        if (!experimental.allowOwnershipTransfer) {
          return { error: 'Cross-owner moves are disabled' };
        }
        const livePhoto = await tx.selectFrom('asset').select('id')
          .where('livePhotoVideoId', '=', source.id).executeTakeFirst();
        if (source.stackId || source.livePhotoVideoId || livePhoto) {
          return { error: 'Unstack the asset and unlink live-photo components before transferring ownership' };
        }
        if (experimental.addAlbumEditor) {
          const albums = await tx.selectFrom('album_asset').select('albumId').where('assetId', '=', source.id).execute();
          if (albums.length > 0) {
            await tx.insertInto('album_user').values(albums.map(({ albumId }) => ({
              albumId, userId: destinationLibrary.ownerId, role: AlbumUserRole.Editor,
            }))).onConflict((oc) => oc.columns(['albumId', 'userId'])
              .doUpdateSet({ role: AlbumUserRole.Editor }).where('album_user.role', '=', AlbumUserRole.Viewer)).execute();
          }
        } else {
          await tx.updateTable('album').set({ albumThumbnailAssetId: null })
            .where('albumThumbnailAssetId', '=', source.id).execute();
          await tx.deleteFrom('album_asset').where('assetId', '=', source.id).execute();
        }
        if (!experimental.keepSharedLinks) {
          await tx.deleteFrom('shared_link_asset').where('assetId', '=', source.id).execute();
        }
        await tx.deleteFrom('tag_asset').where('assetId', '=', source.id).execute();
        await tx.deleteFrom('memory_asset').where('assetId', '=', source.id).execute();
        if (experimental.transferFaces) {
          const faces = await tx.selectFrom('asset_face').innerJoin('person', 'person.personGroupId', 'asset_face.personGroupId')
            .select(['asset_face.id', 'person.personGroupId', 'person.name', 'person.birthDate', 'person.color'])
            .where('asset_face.assetId', '=', source.id).where('person.ownerId', '=', source.ownerId)
            .where('asset_face.deletedAt', 'is', null).orderBy('asset_face.id').execute();
          for (const face of faces) {
            const person = await tx.insertInto('person').values({
              ownerId: destinationLibrary.ownerId, personGroupId: face.personGroupId, name: face.name,
              birthDate: face.birthDate, color: face.color, faceAssetId: face.id,
            }).onConflict((oc) => oc.columns(['ownerId', 'personGroupId']).doNothing())
              .returning(['ownerId', 'personGroupId']).executeTakeFirst();
            if (person) {
              people.push(person);
            }
          }
        } else {
          await tx.deleteFrom('asset_face').where('assetId', '=', source.id).execute();
          await tx.updateTable('asset_job_status').set({ facesRecognizedAt: null }).where('assetId', '=', source.id).execute();
        }
        await tx.insertInto('asset_audit').values({ assetId: source.id, ownerId: source.ownerId }).execute();
      }
      await tx.deleteFrom('asset_file').where('assetId', '=', source.id).where('type', '=', AssetFileType.Sidecar).execute();
      await tx.updateTable('asset').set({
        libraryId: destinationLibrary.id,
        ownerId: destinationLibrary.ownerId,
        originalPath: destinationPath,
        originalFileName: basename(destinationPath),
        checksum: options.checksum,
        checksumAlgorithm: ChecksumAlgorithm.sha1Path,
        fileModifiedAt: options.fileModifiedAt,
        isOffline: false,
        deletedAt: null,
        ...(ownershipChanged && { isFavorite: false, duplicateId: null }),
      }).where('id', '=', source.id).execute();
      return { assetId: source.id, people };
    });
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getStatistics(id: string): Promise<LibraryStatsResponseDto | undefined> {
    const stats = await this.db
      .selectFrom('library')
      .innerJoin('asset', 'asset.libraryId', 'library.id')
      .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select((eb) =>
        eb.fn
          .countAll<number>()
          .filterWhere((eb) =>
            eb.and([eb('asset.type', '=', AssetType.Image), eb('asset.visibility', '!=', AssetVisibility.Hidden)]),
          )
          .as('photos'),
      )
      .select((eb) =>
        eb.fn
          .countAll<number>()
          .filterWhere((eb) =>
            eb.and([eb('asset.type', '=', AssetType.Video), eb('asset.visibility', '!=', AssetVisibility.Hidden)]),
          )
          .as('videos'),
      )
      .select((eb) => eb.fn.coalesce((eb) => eb.fn.sum('asset_exif.fileSizeInByte'), eb.val(0)).as('usage'))
      .where('asset.deletedAt', 'is', null)
      .groupBy('library.id')
      .where('library.id', '=', id)
      .executeTakeFirst();

    // possibly a new library with 0 assets
    if (!stats) {
      const zero = sql<number>`0::int`;
      return this.db
        .selectFrom('library')
        .select(zero.as('photos'))
        .select(zero.as('videos'))
        .select(zero.as('usage'))
        .select(zero.as('total'))
        .where('library.id', '=', id)
        .executeTakeFirst();
    }

    return {
      photos: stats.photos,
      videos: stats.videos,
      usage: stats.usage,
      total: stats.photos + stats.videos,
    };
  }

  streamAssetIds(libraryId: string) {
    return this.db.selectFrom('asset').select(['id']).where('libraryId', '=', libraryId).stream();
  }
}
