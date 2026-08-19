import {describe,expect,it} from 'vitest';
import {parseStartParam} from '../server/schema';
import {scanArchiveBuffer,validateMagicBytes} from '../server/scanner';

describe('button-facing negative paths and scanner boundaries',()=>{
  it('keeps deep links bounded and non-navigating for invalid values',()=>{expect(parseStartParam('../admin/projects')).toEqual({kind:'catalog'});expect(parseStartParam('product_../../etc')).toEqual({kind:'catalog'});expect(parseStartParam('category_%2Fadmin')).toEqual({kind:'catalog'})});
  it('rejects invalid upload formats before archive processing',async()=>{expect(validateMagicBytes(Buffer.from('plain'),'source.zip','application/zip').ok).toBe(false);expect((await scanArchiveBuffer(Buffer.from('plain'),'source.tar','application/x-tar')).ok).toBe(false);expect((await scanArchiveBuffer(Buffer.from('plain'),'source.exe','application/octet-stream')).findings).toContain('extension_not_allowed')});
  it('rejects Windows and POSIX archive-looking upload names',async()=>{for(const name of ['../../evil.zip','..\\..\\evil.zip','C:\\evil.zip','C:/evil.zip'])expect((await scanArchiveBuffer(Buffer.from('plain'),name,'application/zip')).ok).toBe(false)});
});
