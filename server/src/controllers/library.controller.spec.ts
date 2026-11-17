import request from 'supertest';
import { LibraryController } from 'src/controllers/library.controller.js';
import { LibraryService } from 'src/services/library.service.js';
import { Permission } from 'src/enum.js';
import { AuthService } from 'src/services/auth.service.js';
import { ApiKeyFactory } from 'test/factories/api-key.factory.js';
import { factory } from 'test/small.factory.js';
import { ControllerContext, controllerSetup, mockBaseService, newTestService } from 'test/utils.js';

describe(LibraryController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(LibraryService);

  beforeAll(async () => {
    ctx = await controllerSetup(LibraryController, [{ provide: LibraryService, useValue: service }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  const id = factory.uuid();

  describe.each(['add', 'remove', 'move'] as const)('POST /libraries/:id/files/%s authorization', (action) => {
    const dto = action === 'move'
      ? { sourcePath: '/mnt/source.jpg', destinationPath: '/mnt/destination.jpg', destinationLibraryId: id }
      : { path: '/mnt/photo.jpg' };

    it.each([
      { isAdmin: false, permissions: [Permission.All], status: 403 },
      { isAdmin: false, permissions: [Permission.LibraryUpdate], status: 403 },
      { isAdmin: true, permissions: [Permission.LibraryRead], status: 403 },
      { isAdmin: true, permissions: [Permission.LibraryUpdate], status: 204 },
      { isAdmin: true, permissions: [Permission.All], status: 204 },
    ])('requires admin plus key permission: $isAdmin / $permissions', async ({ isAdmin, permissions, status }) => {
      const { sut: auth, mocks } = newTestService(AuthService);
      mocks.apiKey.getKey.mockResolvedValue(ApiKeyFactory.from({ permissions }).user({ isAdmin }).build());
      ctx.authenticate.mockImplementation((request) => auth.authenticate(request));
      service.syncFileAdd.mockResolvedValue();
      service.syncFileRemove.mockResolvedValue();
      service.syncFileMove.mockResolvedValue();

      const response = await request(ctx.getHttpServer())
        .post(`/libraries/${id}/files/${action}`).set('x-api-key', 'test-key').send(dto);

      expect(response.status).toBe(status);
      const calls = service.syncFileAdd.mock.calls.length +
        service.syncFileRemove.mock.calls.length + service.syncFileMove.mock.calls.length;
      expect(calls).toBe(status === 204 ? 1 : 0);
    });

    it.each([false, true])('gates account sessions by admin status: %s', async (isAdmin) => {
      const { sut: auth, mocks } = newTestService(AuthService);
      const user = ApiKeyFactory.from().user({ isAdmin }).build().user;
      mocks.session.getByToken.mockResolvedValue({
        id: factory.uuid(), updatedAt: new Date(), user, isPendingSyncReset: false,
        pinExpiresAt: null, appVersion: null, oauthSid: null,
      });
      ctx.authenticate.mockImplementation((request) => auth.authenticate(request));
      service.syncFileAdd.mockResolvedValue();
      service.syncFileRemove.mockResolvedValue();
      service.syncFileMove.mockResolvedValue();
      const response = await request(ctx.getHttpServer()).post(`/libraries/${id}/files/${action}`)
        .set('Cookie', 'immich_access_token=test-token').send(dto);
      expect(response.status).toBe(isAdmin ? 204 : 403);
    });
  });

  describe('POST /libraries', () => {
    it('should require an owner id', async () => {
      const { status, body } = await request(ctx.getHttpServer()).post('/libraries').send({});

      expect(status).toBe(400);
      expect(body).toEqual(
        factory.responses.validationError([
          { path: ['ownerId'], message: 'Invalid input: expected string, received undefined' },
        ]),
      );
      expect(service.create).not.toHaveBeenCalled();
    });

    it('should reject duplicate import paths', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .post('/libraries')
        .send({ ownerId: id, importPaths: ['/path', '/path'] });

      expect(status).toBe(400);
      expect(body).toEqual(
        factory.responses.validationError([{ path: ['importPaths'], message: 'Array must have unique items' }]),
      );
      expect(service.create).not.toHaveBeenCalled();
    });

    it('should reject duplicate exclusion patterns', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .post('/libraries')
        .send({ ownerId: id, exclusionPatterns: ['**/Raw/**', '**/Raw/**'] });

      expect(status).toBe(400);
      expect(body).toEqual(
        factory.responses.validationError([{ path: ['exclusionPatterns'], message: 'Array must have unique items' }]),
      );
      expect(service.create).not.toHaveBeenCalled();
    });
  });

  describe('PUT /libraries/:id', () => {
    it('should require a valid uuid', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .put('/libraries/invalid')
        .send({ name: 'New Library Name' });

      expect(status).toBe(400);
      expect(body).toEqual(factory.responses.validationError([{ path: ['id'], message: 'Invalid UUID' }]));
      expect(service.update).not.toHaveBeenCalled();
    });

    it('should reject an empty name', async () => {
      const { status, body } = await request(ctx.getHttpServer()).put(`/libraries/${id}`).send({ name: '' });

      expect(status).toBe(400);
      expect(body).toEqual(
        factory.responses.validationError([
          { path: ['name'], message: 'Too small: expected string to have >=1 characters' },
        ]),
      );
      expect(service.update).not.toHaveBeenCalled();
    });

    it('should reject an empty import path', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .put(`/libraries/${id}`)
        .send({ importPaths: [''] });

      expect(status).toBe(400);
      expect(body).toEqual(
        factory.responses.validationError([{ path: ['importPaths'], message: 'Array items must not be empty' }]),
      );
      expect(service.update).not.toHaveBeenCalled();
    });

    it('should reject duplicate import paths', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .put(`/libraries/${id}`)
        .send({ importPaths: ['/path', '/path'] });

      expect(status).toBe(400);
      expect(body).toEqual(
        factory.responses.validationError([{ path: ['importPaths'], message: 'Array must have unique items' }]),
      );
      expect(service.update).not.toHaveBeenCalled();
    });

    it('should reject an empty exclusion pattern', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .put(`/libraries/${id}`)
        .send({ exclusionPatterns: [''] });

      expect(status).toBe(400);
      expect(body).toEqual(
        factory.responses.validationError([{ path: ['exclusionPatterns'], message: 'Array items must not be empty' }]),
      );
      expect(service.update).not.toHaveBeenCalled();
    });

    it('should reject duplicate exclusion patterns', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .put(`/libraries/${id}`)
        .send({ exclusionPatterns: ['**/*.jpg', '**/*.jpg'] });

      expect(status).toBe(400);
      expect(body).toEqual(
        factory.responses.validationError([{ path: ['exclusionPatterns'], message: 'Array must have unique items' }]),
      );
      expect(service.update).not.toHaveBeenCalled();
    });
  });

  describe('POST /libraries/:id/validate', () => {
    it('should require a valid uuid', async () => {
      const { status, body } = await request(ctx.getHttpServer()).post('/libraries/invalid/validate').send({});

      expect(status).toBe(400);
      expect(body).toEqual(factory.responses.validationError([{ path: ['id'], message: 'Invalid UUID' }]));
      expect(service.validate).not.toHaveBeenCalled();
    });

    it('should not require import paths', async () => {
      service.validate.mockResolvedValue({ importPaths: [] });

      const { status } = await request(ctx.getHttpServer()).post(`/libraries/${id}/validate`).send({});

      expect(status).toBe(200);
      expect(service.validate).toHaveBeenCalledWith(id, {});
    });
  });

  describe('GET /libraries/:id/statistics', () => {
    it('should require a valid uuid', async () => {
      const { status, body } = await request(ctx.getHttpServer()).get('/libraries/invalid/statistics');

      expect(status).toBe(400);
      expect(body).toEqual(factory.responses.validationError([{ path: ['id'], message: 'Invalid UUID' }]));
      expect(service.getStatistics).not.toHaveBeenCalled();
    });
  });

  describe('POST /libraries/:id/scan', () => {
    it('should require a valid uuid', async () => {
      const { status, body } = await request(ctx.getHttpServer()).post('/libraries/invalid/scan');

      expect(status).toBe(400);
      expect(body).toEqual(factory.responses.validationError([{ path: ['id'], message: 'Invalid UUID' }]));
      expect(service.queueScan).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /libraries/:id', () => {
    it('should require a valid uuid', async () => {
      const { status, body } = await request(ctx.getHttpServer()).delete('/libraries/invalid');

      expect(status).toBe(400);
      expect(body).toEqual(factory.responses.validationError([{ path: ['id'], message: 'Invalid UUID' }]));
      expect(service.delete).not.toHaveBeenCalled();
    });
  });
});
