export type DomainErrorCode =
  | 'DUPLICATE_NOTE'
  | 'EMPTY_QUICK_TEXT'
  | 'INVALID_BOUNDS'
  | 'INVALID_DRAWING_SCENE'
  | 'INVALID_NOTE'
  | 'NOTE_NOT_FOUND'
  | 'QUICK_TEXT_TOO_LONG'
  | 'REVISION_CONFLICT'
  | 'SCENE_DOES_NOT_FIT'
  | 'WALL_ALREADY_INITIALIZED'
  | 'WALL_NOT_INITIALIZED';

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}
