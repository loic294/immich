import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import {
  CreateLibraryDto,
  LibraryFileMoveDto,
  LibraryFilePathDto,
  LibraryResponseDto,
  LibraryScanDto,
  LibraryStatsResponseDto,
  UpdateLibraryDto,
  ValidateLibraryDto,
  ValidateLibraryResponseDto,
} from 'src/dtos/library.dto.js';
import { ApiTag, Permission } from 'src/enum.js';
import { Authenticated } from 'src/middleware/auth.guard.js';
import { LibraryService } from 'src/services/library.service.js';
import { UUIDParamDto } from 'src/validation.js';

@ApiTags(ApiTag.Libraries)
@Controller('libraries')
export class LibraryController {
  constructor(private service: LibraryService) {}

  @Get()
  @Authenticated({ permission: Permission.LibraryRead, admin: true })
  @Endpoint({
    summary: 'Retrieve libraries',
    description: 'Retrieve a list of external libraries.',
    history: new HistoryBuilder().added('v1').beta('v1').stable('v2'),
  })
  getAllLibraries(): Promise<LibraryResponseDto[]> {
    return this.service.getAll();
  }

  @Post()
  @Authenticated({ permission: Permission.LibraryCreate, admin: true })
  @Endpoint({
    summary: 'Create a library',
    description: 'Create a new external library.',
    history: new HistoryBuilder().added('v1').beta('v1').stable('v2'),
  })
  createLibrary(@Body() dto: CreateLibraryDto): Promise<LibraryResponseDto> {
    return this.service.create(dto);
  }

  @Get(':id')
  @Authenticated({ permission: Permission.LibraryRead, admin: true })
  @Endpoint({
    summary: 'Retrieve a library',
    description: 'Retrieve an external library by its ID.',
    history: new HistoryBuilder().added('v1').beta('v1').stable('v2'),
  })
  getLibrary(@Param() { id }: UUIDParamDto): Promise<LibraryResponseDto> {
    return this.service.get(id);
  }

  @Put(':id')
  @Authenticated({ permission: Permission.LibraryUpdate, admin: true })
  @Endpoint({
    summary: 'Update a library',
    description: 'Update an existing external library.',
    history: new HistoryBuilder().added('v1').beta('v1').stable('v2').v3PatchMigration(),
  })
  updateLibrary(@Param() { id }: UUIDParamDto, @Body() dto: UpdateLibraryDto): Promise<LibraryResponseDto> {
    return this.service.update(id, dto);
  }

  @Patch(':id')
  @ApiExcludeEndpoint()
  @Authenticated({ permission: Permission.LibraryUpdate, admin: true })
  updateLibraryV3(@Param() { id }: UUIDParamDto, @Body() dto: UpdateLibraryDto): Promise<LibraryResponseDto> {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Authenticated({ permission: Permission.LibraryDelete, admin: true })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Delete a library',
    description: 'Delete an external library by its ID.',
    history: new HistoryBuilder().added('v1').beta('v1').stable('v2'),
  })
  deleteLibrary(@Param() { id }: UUIDParamDto): Promise<void> {
    return this.service.delete(id);
  }

  @Post(':id/validate')
  @Authenticated({ admin: true })
  @HttpCode(HttpStatus.OK)
  @Endpoint({
    summary: 'Validate library settings',
    description: 'Validate the settings of an external library.',
    history: new HistoryBuilder().added('v1').beta('v1').stable('v2'),
  })
  // TODO: change endpoint to validate current settings instead
  validate(@Param() { id }: UUIDParamDto, @Body() dto: ValidateLibraryDto): Promise<ValidateLibraryResponseDto> {
    return this.service.validate(id, dto);
  }

  @Get(':id/statistics')
  @Authenticated({ permission: Permission.LibraryStatistics, admin: true })
  @Endpoint({
    summary: 'Retrieve library statistics',
    description:
      'Retrieve statistics for a specific external library, including number of videos, images, and storage usage.',
    history: new HistoryBuilder().added('v1').beta('v1').stable('v2'),
  })
  getLibraryStatistics(@Param() { id }: UUIDParamDto): Promise<LibraryStatsResponseDto> {
    return this.service.getStatistics(id);
  }

  @Post(':id/files/add')
  @Authenticated({ permission: Permission.LibraryUpdate, admin: true })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Synchronize an added external library file',
    description: 'Synchronize an external library asset after it has been added to the filesystem.',
    history: new HistoryBuilder().added('v4.0.0').alpha('v4.0.0'),
  })
  syncFileAdd(@Param() { id }: UUIDParamDto, @Body() dto: LibraryFilePathDto): Promise<void> {
    return this.service.syncFileAdd(id, dto);
  }

  @Post(':id/files/remove')
  @Authenticated({ permission: Permission.LibraryUpdate, admin: true })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Synchronize a removed external library file',
    description: 'Synchronize an external library asset after it has been removed from the filesystem.',
    history: new HistoryBuilder().added('v4.0.0').alpha('v4.0.0'),
  })
  syncFileRemove(@Param() { id }: UUIDParamDto, @Body() dto: LibraryFilePathDto): Promise<void> {
    return this.service.syncFileRemove(id, dto);
  }

  @Post(':id/files/move')
  @Authenticated({ permission: Permission.LibraryUpdate, admin: true })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Synchronize a moved external library file',
    description:
      'Synchronize an external library asset after it has been moved on the filesystem, optionally to another library. File management must be enabled in the admin settings. Requires an administrator and library.update permission for API keys.',
    history: new HistoryBuilder().added('v4.0.0').alpha('v4.0.0'),
  })
  syncFileMove(@Param() { id }: UUIDParamDto, @Body() dto: LibraryFileMoveDto): Promise<void> {
    return this.service.syncFileMove(id, dto);
  }

  @Post(':id/scan')
  @Authenticated({ permission: Permission.LibraryUpdate, admin: true })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Scan a library',
    description: 'Queue a scan for the external library to find and import new assets.',
    history: new HistoryBuilder().added('v1').beta('v1').stable('v2'),
  })
  scanLibrary(@Param() { id }: UUIDParamDto, @Body() dto: LibraryScanDto): Promise<void> {
    return this.service.queueScan(id, dto);
  }
}
