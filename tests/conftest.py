import os

# Set up test environment variables BEFORE importing any backend modules
os.environ["SUPABASE_URL"] = "https://example.supabase.co"
os.environ["SUPABASE_ANON_KEY"] = "test-anon-key"
os.environ["SUPABASE_SERVICE_KEY"] = "test-service-key"
os.environ["SUPABASE_JWT_SECRET"] = "test-jwt-secret"
os.environ["CORS_ORIGINS"] = "http://localhost:5173"
