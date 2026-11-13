import { post } from '../workspace-data';

export type UploadConfig = { direct: boolean; maxBytes: number; allowedTypes: string[] };
export async function attach(root: string, file: File, config: UploadConfig) {
  if (file.size > config.maxBytes) throw Error('File exceeds the upload limit.');
  const metadata = { filename: file.name, mimeType: file.type || 'application/octet-stream' };
  if (config.direct) {
    const ticket = await post<{
      file: { id: string };
      upload: { url: string; headers: Record<string, string> };
    }>(root + '/uploads', { ...metadata, size: file.size });
    const response = await fetch(ticket.upload.url, {
      method: 'PUT',
      headers: ticket.upload.headers,
      body: file,
    });
    if (!response.ok) throw Error('Upload failed. Try again.');
    return (await post<{ id: string }>(root + '/uploads/' + ticket.file.id + '/complete')).id;
  }
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(Error('Could not read file.'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.readAsDataURL(file);
  });
  return (await post<{ id: string }>(root + '/files', { ...metadata, contentBase64: data })).id;
}
