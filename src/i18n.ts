/**
 * 国際化（i18n）対応
 */

import type { Language } from './types';

/** 翻訳キー */
export type TranslationKey =
  | 'title'
  | 'loadSpec'
  | 'clearTraffic'
  | 'noTraffic'
  | 'request'
  | 'response'
  | 'headers'
  | 'body'
  | 'path'
  | 'queryParams'
  | 'validation'
  | 'validationOk'
  | 'validationError'
  | 'requestValidation'
  | 'responseValidation'
  | 'selectTraffic'
  | 'specLoaded'
  | 'specLoadError'
  | 'noSpec'
  | 'status'
  | 'errors'
  | 'importSpec'
  | 'importFile'
  | 'clearSpec'
  | 'close'
  | 'specCleared'
  | 'expected'
  | 'actualType'
  | 'actualValue'
  | 'filterMatchSpec'
  | 'filterErrorOnly'
  | 'noMatchingTraffic'
  | 'tooSmallArea'
  | 'errorPathNotFound'
  | 'errorMethodNotAllowed'
  | 'errorUnexpectedStatusCode'
  | 'errorUnexpectedBody'
  | 'errorRequiredBody'
  | 'errorRequiredParam'
  | 'errorRequiredHeader'
  | 'errorSchemaValidation'
  | 'errorUnresolvedRef'
  | 'none'
  | 'chooseFile'
  | 'noFileSelected';

/** 翻訳データ */
const translations: Record<Language, Record<TranslationKey, string>> = {
  ja: {
    title: 'ばりっどーぬ - ShibaGuard',
    loadSpec: '仕様書',
    clearTraffic: '履歴削除',
    noTraffic: 'トラフィックがありません',
    request: 'リクエスト',
    response: 'レスポンス',
    headers: 'ヘッダー',
    body: 'ボディ',
    path: 'パス',
    queryParams: 'クエリパラメータ',
    validation: 'バリデーション',
    validationOk: '✓ OK',
    validationError: '✗ エラー',
    requestValidation: 'リクエスト検証',
    responseValidation: 'レスポンス検証',
    selectTraffic: '左側からトラフィックを選択してください',
    specLoaded: '仕様書を読み込みました',
    specLoadError: '仕様書の読み込みに失敗しました',
    noSpec: '仕様書未読込',
    status: 'ステータス',
    errors: 'エラー',
    importSpec: 'OpenAPI仕様書をインポート',
    importFile: 'ファイルを選択 (YAML/JSON):',
    clearSpec: '仕様書を削除',
    close: '閉じる',
    specCleared: '仕様書を削除しました',
    expected: '期待',
    actualType: '実際の型',
    actualValue: '実際の値',
    filterMatchSpec: '仕様書にマッチするもののみ',
    filterErrorOnly: 'バリデーションエラーのもののみ',
    noMatchingTraffic: 'フィルタに一致するトラフィックがありません',
    tooSmallArea: '領域が狭すぎて表示ができません。',
    errorPathNotFound: 'パス "{path}" はOpenAPI仕様書に定義されていません',
    errorMethodNotAllowed: 'メソッド "{method}" はパス "{path}" に定義されていません',
    errorUnexpectedStatusCode:
      'ステータスコード {statusCode} は "{path}" の "{method}" に定義されていません',
    errorUnexpectedBody: '204 No Content レスポンスにはボディを含めるべきではありません',
    errorRequiredBody: 'リクエストボディは必須です',
    errorRequiredParam: '必須パラメータ "{name}" がありません',
    errorRequiredHeader: '必須レスポンスヘッダー "{name}" がありません',
    errorSchemaValidation: 'スキーマ検証中にエラー: {detail}',
    errorUnresolvedRef: 'スキーマに未解決の $ref が残っています ({detail})',
    none: '(なし)',
    chooseFile: 'ファイルを選択',
    noFileSelected: '選択されていません',
  },
  en: {
    title: 'ShibaGuard',
    loadSpec: 'Spec',
    clearTraffic: 'Clear',
    noTraffic: 'No traffic',
    request: 'Request',
    response: 'Response',
    headers: 'Headers',
    body: 'Body',
    path: 'Path',
    queryParams: 'Query Params',
    validation: 'Validation',
    validationOk: '✓ OK',
    validationError: '✗ Error',
    requestValidation: 'Request Validation',
    responseValidation: 'Response Validation',
    selectTraffic: 'Select traffic from the left panel',
    specLoaded: 'Spec loaded successfully',
    specLoadError: 'Failed to load spec',
    noSpec: 'No spec loaded',
    status: 'Status',
    errors: 'Errors',
    importSpec: 'Import OpenAPI Spec',
    importFile: 'Select file (YAML/JSON):',
    clearSpec: 'Clear Spec',
    close: 'Close',
    specCleared: 'Spec cleared',
    expected: 'Expected',
    actualType: 'Actual type',
    actualValue: 'Actual value',
    filterMatchSpec: 'Spec matches only',
    filterErrorOnly: 'Validation errors only',
    noMatchingTraffic: 'No traffic matching filters',
    tooSmallArea: 'Area too small to display.',
    errorPathNotFound: 'Path "{path}" is not defined in OpenAPI spec',
    errorMethodNotAllowed: 'Method "{method}" is not defined for path "{path}"',
    errorUnexpectedStatusCode: 'Status code {statusCode} is not defined for "{method}" "{path}"',
    errorUnexpectedBody: '204 No Content response should not contain a body',
    errorRequiredBody: 'Request body is required',
    errorRequiredParam: 'Required parameter "{name}" is missing',
    errorRequiredHeader: 'Required response header "{name}" is missing',
    errorSchemaValidation: 'Error during schema validation: {detail}',
    errorUnresolvedRef: 'Unresolved $ref remains in the schema ({detail})',
    none: '(none)',
    chooseFile: 'Choose File',
    noFileSelected: 'No file selected',
  },
};

/** 現在の言語 */
let currentLanguage: Language = 'en';

/**
 * 言語を設定
 */
export function setLanguage(lang: Language): void {
  currentLanguage = lang;
}

/**
 * 現在の言語を取得
 */
export function getLanguage(): Language {
  return currentLanguage;
}

/**
 * 翻訳を取得
 */
export function t(key: TranslationKey): string {
  return translations[currentLanguage][key] || key;
}

/**
 * 言語を切り替え
 */
export function toggleLanguage(): Language {
  currentLanguage = currentLanguage === 'ja' ? 'en' : 'ja';
  return currentLanguage;
}
