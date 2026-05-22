# Overview
Miami Job Corps Cafeteria inventory portal.

## Direction
Python-first backend with a centralized architect directory for system notes.

## Stack
- Flask for API and session auth
- Python modules for barcodes, inventory sync, OCR, and AI parsing
- Supabase Python client for cloud sync
- Gemini for invoice parsing
- OCR pipeline for invoice text extraction

## Notes
- Keep frontend HTML as the presentation layer.
- Keep backend logic in Python modules.
- Avoid adding new JavaScript application logic.
