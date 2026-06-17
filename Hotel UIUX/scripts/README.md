# Scripts

## Quick cleanup (PowerShell, từ thư mục gốc dự án)

Xóa cache Vite / npm cache cục bộ (an toàn, có thể chạy lại `npm install`):

```powershell
Remove-Item -Recurse -Force .\.npm-cache, .\frontend\node_modules\.vite -ErrorAction SilentlyContinue
```

Build lại:

```bash
npm run build
```
