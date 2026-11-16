import { useRef, useState } from 'react';
import { CheckCircle2, UploadCloud } from 'lucide-react';

// Click or drop a file. Shows the chosen file name and size.
export default function Dropzone({ id, title, hint, accept, file, onFile, icon: Icon = UploadCloud }) {
  const [over, setOver] = useState(false);
  const inputRef = useRef(null);
  const pick = (f) => f && onFile(f);
  return (
    <div
      className={`dropzone ${over ? 'is-over' : ''} ${file ? 'has-file' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files?.[0]); }}
    >
      <label htmlFor={id} className="dropzone-body">
        {file ? <CheckCircle2 size={26} className="dz-icon ok" aria-hidden="true" /> : <Icon size={26} className="dz-icon" aria-hidden="true" />}
        <span className="dz-title">{title}</span>
        <span className="dz-file">{file ? `${file.name} (${Math.max(1, Math.round(file.size / 1024))} KB)` : hint}</span>
      </label>
      <input
        ref={inputRef}
        id={id}
        className="sr-only"
        type="file"
        accept={accept}
        onChange={(e) => { pick(e.target.files?.[0]); if (inputRef.current) inputRef.current.value = ''; }}
      />
    </div>
  );
}
