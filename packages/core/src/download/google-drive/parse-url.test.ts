import { describe, expect, it } from 'vitest';
import { DriveLinkResolutionError } from '../source/errors.js';
import { isGoogleDriveHost, parseGoogleDriveFileUrl } from './parse-url.js';

describe('parseGoogleDriveFileUrl', () => {
  it.each([
    'https://drive.google.com/file/d/Abc_123/view?usp=sharing',
    'https://drive.google.com/open?id=Abc_123',
    'https://drive.google.com/uc?export=download&id=Abc_123',
    'https://docs.google.com/open?id=Abc_123',
    'https://drive.usercontent.google.com/download?id=Abc_123&export=download',
  ])('extracts a file ID from %s', (url) => {
    expect(parseGoogleDriveFileUrl(url).id).toBe('Abc_123');
  });

  it('recognizes only the explicit Google Drive download hosts', () => {
    expect(isGoogleDriveHost('drive.google.com')).toBe(true);
    expect(isGoogleDriveHost('drive.usercontent.google.com')).toBe(true);
    expect(isGoogleDriveHost('notdrive.google.com.attacker.test')).toBe(false);
    expect(isGoogleDriveHost('google.com')).toBe(false);
  });

  it.each([
    'http://drive.google.com/open?id=Abc_123',
    'https://drive.google.com/drive/folders/Abc_123',
    'https://drive.google.com/open?id=first&id=second',
    'https://drive.google.com/open?id=contains.dot',
    'https://user:pass@drive.google.com/open?id=Abc_123',
    'https://drive.google.com.attacker.test/open?id=Abc_123',
  ])('rejects unsupported or unsafe Drive links: %s', (url) => {
    expect(() => parseGoogleDriveFileUrl(url)).toThrow(DriveLinkResolutionError);
  });
});
