from flask import Blueprint

from backend.response import error_response

files_bp = Blueprint('files', __name__, url_prefix='/api/files')

_NOT_IMPL = error_response('Coming soon', status_code=501)


@files_bp.post('/upload')
def upload_file():
    return _NOT_IMPL


@files_bp.get('')
def list_files():
    return _NOT_IMPL


@files_bp.get('/<file_id>')
def get_file(file_id):
    return _NOT_IMPL


@files_bp.delete('/<file_id>')
def delete_file(file_id):
    return _NOT_IMPL
