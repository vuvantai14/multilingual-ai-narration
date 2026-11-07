import type { ErrorRequestHandler } from 'express';
import { stopE2eOnRequestError } from '../services/e2e-test-run.js';
import { expectedE2eEmptyRead } from '../services/e2e-runtime-boundary.js';
import multer from 'multer';
import { env } from '../config/env.js';
import { AppError } from '../utils/app-error.js';
import { errorResponse } from '../utils/api-response.js';

export const errorHandlerMiddleware: ErrorRequestHandler = (error, _request, response, _next) => {
  // Native scoped denial is a structured conflict, never a misleading 500.
  // Only exact fixed guard codes are exposed; no paths, payloads or secrets.
  const guardCodes=['S32_E2E_ACTUAL_WRITE_DENIED','S32_E2E_ACTUAL_STORAGE_DENIED','S32_E2E_RUNTIME_NOT_PREPARED','S32_E2E_STORAGE_PATH_NOT_GRANTED','S32_E2E_STORAGE_DENIED','S32_SCOPED_WRITE_DENIED','S32_E2E_UPLOAD_REQUEST_DENIED','S32_E2E_CLEANUP_NOT_APPROVED','S33_SOURCE_CLAIM_DENIED','S33_TARGET_CLAIM_DENIED','S33_VOICE_CLAIM_DENIED'];
  const nativeFieldDenial=error instanceof Error&&/^S32_E2E_ACTUAL_WRITE_DENIED:[a-z]+:\$(?:set|unset|inc|setOnInsert):[a-zA-Z0-9_.]{1,60}$/.test(error.message);
  if(error instanceof Error&&(guardCodes.includes(error.message)||nativeFieldDenial)){
    const code=nativeFieldDenial?'S32_E2E_ACTUAL_WRITE_DENIED':error.message;
    error=new AppError(409,code,`Thao tác bị scoped guard chặn (${code}). Dừng kiểm thử, không retry hoặc tạo dự án khác.`);
  }
  if(error instanceof Error&&['S32_E2E_TRANSACTION_UNCERTAIN','S32_QUOTA_COMMIT_UNCERTAIN'].includes(error.message))error=new AppError(503,error.message,'Kết quả ghi dữ liệu chưa xác định (UNCERTAIN). Chỉ kiểm tra trạng thái, không retry hoặc tạo lại.');
  const emptyRead=error instanceof AppError&&expectedE2eEmptyRead(_request.method,_request.originalUrl,_request.user?.id??'',error.statusCode,error.code);
  if(!emptyRead)stopE2eOnRequestError({method:_request.method,path:_request.originalUrl,
    status:error instanceof AppError?error.statusCode:error instanceof multer.MulterError?error.code==='LIMIT_FILE_SIZE'?413:400:500,
    code:error instanceof AppError?error.code:error instanceof multer.MulterError?'UPLOAD_ERROR':'INTERNAL_SERVER_ERROR'});
  if (error instanceof multer.MulterError) {
    const tooLarge = error.code === 'LIMIT_FILE_SIZE';
    response.status(tooLarge ? 413 : 400).json(
      errorResponse(tooLarge ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR', tooLarge ? 'Tệp tải lên vượt quá dung lượng cho phép.' : 'Tệp tải lên không hợp lệ.'),
    );
    return;
  }
  if (error instanceof AppError) {
    response.status(error.statusCode).json(errorResponse(error.code, error.message));
    return;
  }

  if (env.nodeEnv !== 'test') {
    console.error('Lỗi máy chủ không mong đợi:', error);
  }
  response.status(500).json(errorResponse('INTERNAL_SERVER_ERROR', 'Đã xảy ra lỗi máy chủ.'));
};
