import { Kysely } from 'kysely';
import { defaults } from 'src/dtos/config.dto.js';
import { AlbumUserRole, AssetFileType, SharedLinkType } from 'src/enum.js';
import { LibraryRepository } from 'src/repositories/library.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { DB } from 'src/schema/index.js';
import { BaseService } from 'src/services/base.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { newEmbedding } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let db: Kysely<DB>;
beforeAll(async () => {
  db = await getKyselyDB();
});
afterAll(async () => {
  await db?.destroy();
});

const setup = async () => {
  const { ctx } = newMediumService(BaseService, { database: db, real: [], mock: [LoggingRepository] });
  const sut = ctx.get(LibraryRepository);
  const { user: sourceOwner } = await ctx.newUser({ email: `source-${crypto.randomUUID()}@photos.example` });
  const { user: destinationOwner } = await ctx.newUser({ email: `destination-${crypto.randomUUID()}@photos.example` });
  const sourceLibrary = await sut.create({
    name: 'Source library',
    ownerId: sourceOwner.id,
    importPaths: ['/mnt/source'],
    exclusionPatterns: [],
  });
  const destinationLibrary = await sut.create({
    name: 'Destination library',
    ownerId: destinationOwner.id,
    importPaths: ['/mnt/destination'],
    exclusionPatterns: [],
  });
  const { asset } = await ctx.newAsset({
    ownerId: sourceOwner.id,
    libraryId: sourceLibrary.id,
    isExternal: true,
    originalPath: '/mnt/source/photo.jpg',
    isFavorite: true,
  });
  const { album } = await ctx.newAlbum({ ownerId: sourceOwner.id, albumName: 'Example album' }, [asset.id]);
  const { person } = await ctx.newPerson({ ownerId: sourceOwner.id, name: 'Example person' });
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
  await db.insertInto('face_search').values({ faceId: assetFace.id, embedding: newEmbedding() }).execute();
  await db.insertInto('asset_job_status').values({ assetId: asset.id, facesRecognizedAt: new Date() }).execute();
  const link = await db
    .insertInto('shared_link')
    .values({
      userId: sourceOwner.id,
      key: Buffer.from(crypto.randomUUID()),
      type: SharedLinkType.Individual,
      allowUpload: false,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await db.insertInto('shared_link_asset').values({ sharedLinkId: link.id, assetId: asset.id }).execute();
  await ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Sidecar, path: '/mnt/source/photo.jpg.xmp' });
  const options = {
    sourceLibrary,
    destinationLibrary,
    sourcePath: asset.originalPath,
    destinationPath: '/mnt/destination/photo.jpg',
    assetId: asset.id,
    checksum: Buffer.from(`destination-${asset.id}`),
    fileModifiedAt: new Date(),
    experimental: { ...defaults.library.experimental, allowOwnershipTransfer: true },
  };
  return {
    ctx,
    sut,
    sourceOwner,
    destinationOwner,
    sourceLibrary,
    destinationLibrary,
    asset,
    album,
    person,
    assetFace,
    link,
    options,
  };
};

describe('cross-library move transactions', () => {
  it('keeps owner-specific data for moves between libraries with the same owner', async () => {
    const { sut, options, asset, sourceOwner, assetFace } = await setup();
    const destinationLibrary = await sut.update(options.destinationLibrary.id, { ownerId: sourceOwner.id });
    expect(
      await sut.moveAsset({
        ...options,
        destinationLibrary,
        experimental: defaults.library.experimental,
      }),
    ).toEqual({ assetId: asset.id, faceIds: [], detectFaces: false });
    expect(await db.selectFrom('album_asset').selectAll().where('assetId', '=', asset.id).execute()).toHaveLength(1);
    expect(await db.selectFrom('asset_face').select('id').where('id', '=', assetFace.id).execute()).toHaveLength(1);
  });

  it('rejects stacked ownership transfers without modifying the stack', async () => {
    const { ctx, sut, options, asset, sourceOwner } = await setup();
    const { asset: other } = await ctx.newAsset({ ownerId: sourceOwner.id });
    const { stack } = await ctx.newStack({ ownerId: sourceOwner.id }, [asset.id, other.id]);
    expect(await sut.moveAsset(options)).toHaveProperty('error');
    expect(await db.selectFrom('asset').select('stackId').where('id', '=', asset.id).executeTakeFirst()).toEqual({
      stackId: stack.id,
    });
  });

  it('preserves asset identity and metadata while clearing private owner associations by default', async () => {
    const { sut, options, asset, album, assetFace, sourceOwner, destinationOwner } = await setup();
    expect(await sut.moveAsset(options)).toEqual({ assetId: asset.id, faceIds: [], detectFaces: true });
    const moved = await db.selectFrom('asset').selectAll().where('id', '=', asset.id).executeTakeFirstOrThrow();
    expect(moved).toMatchObject({
      ownerId: destinationOwner.id,
      libraryId: options.destinationLibrary.id,
      originalPath: options.destinationPath,
      isFavorite: false,
      isOffline: false,
      deletedAt: null,
      fileCreatedAt: asset.fileCreatedAt,
    });
    expect(await db.selectFrom('album_asset').selectAll().where('assetId', '=', asset.id).execute()).toEqual([]);
    expect(await db.selectFrom('shared_link_asset').selectAll().where('assetId', '=', asset.id).execute()).toEqual([]);
    expect(await db.selectFrom('asset_face').selectAll().where('id', '=', assetFace.id).execute()).toEqual([]);
    expect(await db.selectFrom('face_search').selectAll().where('faceId', '=', assetFace.id).execute()).toEqual([]);
    expect(await db.selectFrom('asset_file').selectAll().where('assetId', '=', asset.id).execute()).toEqual([]);
    expect(
      await db
        .selectFrom('album_user')
        .select('role')
        .where('albumId', '=', album.id)
        .where('userId', '=', sourceOwner.id)
        .executeTakeFirst(),
    ).toEqual({ role: AlbumUserRole.Owner });
    expect(
      await db.selectFrom('asset_audit').select('ownerId').where('assetId', '=', asset.id).executeTakeFirst(),
    ).toEqual({ ownerId: sourceOwner.id });
  });

  it('optionally adds an album editor and reuses detections without sharing person identities', async () => {
    const { ctx, sut, options, asset, album, assetFace, person, sourceOwner, destinationOwner, link } = await setup();
    options.experimental = {
      allowOwnershipTransfer: true,
      addAlbumEditor: true,
      keepSharedLinks: true,
      transferFaces: true,
    };
    await ctx.newAlbumUser({ albumId: album.id, userId: destinationOwner.id, role: AlbumUserRole.Viewer });
    expect(await sut.moveAsset(options)).toEqual({ assetId: asset.id, faceIds: [assetFace.id], detectFaces: false });
    expect(
      await db
        .selectFrom('album_user')
        .select('role')
        .where('albumId', '=', album.id)
        .where('userId', '=', sourceOwner.id)
        .executeTakeFirst(),
    ).toEqual({ role: AlbumUserRole.Owner });
    expect(
      await db
        .selectFrom('album_user')
        .select('role')
        .where('albumId', '=', album.id)
        .where('userId', '=', destinationOwner.id)
        .executeTakeFirst(),
    ).toEqual({ role: AlbumUserRole.Editor });
    expect(await db.selectFrom('album_asset').selectAll().where('assetId', '=', asset.id).execute()).toHaveLength(1);
    expect(await db.selectFrom('shared_link_asset').selectAll().where('assetId', '=', asset.id).execute()).toHaveLength(
      1,
    );
    expect(await db.selectFrom('shared_link').select('userId').where('id', '=', link.id).executeTakeFirst()).toEqual({
      userId: sourceOwner.id,
    });
    expect(
      await db
        .selectFrom('asset_face')
        .select(['ownerId', 'personGroupId'])
        .where('id', '=', assetFace.id)
        .executeTakeFirst(),
    ).toEqual({ ownerId: destinationOwner.id, personGroupId: null });
    expect(
      await db.selectFrom('face_search').select('faceId').where('faceId', '=', assetFace.id).execute(),
    ).toHaveLength(1);
    expect(
      await db
        .selectFrom('person')
        .selectAll()
        .where('ownerId', '=', destinationOwner.id)
        .where('personGroupId', '=', person.personGroupId)
        .execute(),
    ).toEqual([]);
  });

  it('never downgrades an existing destination album owner to editor', async () => {
    const { ctx, sut, options, asset, destinationOwner } = await setup();
    const { album } = await ctx.newAlbum({ ownerId: destinationOwner.id }, [asset.id]);
    options.experimental.addAlbumEditor = true;
    await sut.moveAsset(options);
    expect(
      await db
        .selectFrom('album_user')
        .select('role')
        .where('albumId', '=', album.id)
        .where('userId', '=', destinationOwner.id)
        .executeTakeFirst(),
    ).toEqual({ role: AlbumUserRole.Owner });
  });

  it('rejects destination collisions without deleting either asset', async () => {
    const { ctx, sut, options, asset, destinationOwner } = await setup();
    const { asset: destination } = await ctx.newAsset({
      ownerId: destinationOwner.id,
      libraryId: options.destinationLibrary.id,
      originalPath: options.destinationPath,
    });
    expect(await sut.moveAsset(options)).toHaveProperty('error');
    expect(
      await db.selectFrom('asset').select('id').where('id', 'in', [asset.id, destination.id]).execute(),
    ).toHaveLength(2);
    expect(await db.selectFrom('album_asset').selectAll().where('assetId', '=', asset.id).execute()).toHaveLength(1);
  });

  it('retries only the original moved asset and does not repeat private association changes', async () => {
    const { sut, options, asset } = await setup();
    await sut.moveAsset(options);
    expect(await sut.moveAsset(options)).toMatchObject({ assetId: asset.id });
    expect(await sut.moveAsset({ ...options, assetId: undefined })).toHaveProperty('error');
    expect(await db.selectFrom('asset_audit').selectAll().where('assetId', '=', asset.id).execute()).toHaveLength(1);
  });

  it('rolls back association changes if updating the asset fails', async () => {
    const { ctx, sut, options, asset, assetFace, sourceOwner, destinationOwner } = await setup();
    await ctx.newAsset({
      ownerId: destinationOwner.id,
      libraryId: options.destinationLibrary.id,
      originalPath: '/mnt/destination/other.jpg',
      checksum: options.checksum,
    });
    await expect(sut.moveAsset(options)).rejects.toThrow();
    expect(await db.selectFrom('asset').select('ownerId').where('id', '=', asset.id).executeTakeFirst()).toEqual({
      ownerId: sourceOwner.id,
    });
    expect(await db.selectFrom('album_asset').selectAll().where('assetId', '=', asset.id).execute()).toHaveLength(1);
    expect(await db.selectFrom('asset_face').select('id').where('id', '=', assetFace.id).execute()).toHaveLength(1);
    expect(await db.selectFrom('asset_audit').selectAll().where('assetId', '=', asset.id).execute()).toEqual([]);
  });

  it('fails closed when library settings change after path validation', async () => {
    const { sut, options, destinationLibrary } = await setup();
    await sut.update(destinationLibrary.id, { importPaths: ['/mnt/changed'] });
    expect(await sut.moveAsset(options)).toHaveProperty('error');
  });
});
