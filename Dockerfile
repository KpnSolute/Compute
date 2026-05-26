FROM python:3.12-slim

# Create non-root user
RUN adduser --disabled-password --gecos '' appuser

WORKDIR /app

# Copy backend requirements first for better caching
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Set proper permissions
RUN chown -R appuser:appuser /app
USER appuser

ENV PYTHONPATH=/app
ENV FLASK_ENV=production

# Container listens on 5000; set WEBSITES_PORT=5000 in Azure App Service settings
EXPOSE 5000

# Health check — use Python so we don't need curl in the slim image
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request, os; urllib.request.urlopen('http://localhost:' + os.environ.get('PORT','5000') + '/')"

CMD gunicorn -b 0.0.0.0:${PORT:-5000} --workers 4 --timeout 120 --access-logfile - --error-logfile - backend.main:app
