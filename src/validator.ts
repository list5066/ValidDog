/**
 * OpenAPI バリデーター
 *
 * OpenAPI仕様書を読み込んでリクエスト・レスポンスの内容を検証し、
 * スキーマ違反がないか確認するモジュール。
 *
 * Chrome拡張機能での使用を想定（evalを使用しない）
 */

import yaml from 'js-yaml';
import { Validator as JsonSchemaValidator } from 'jsonschema';

// =============================================================================
// 型定義
// =============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

/** OpenAPI仕様書の基本構造 */
export interface OpenAPISpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  servers?: Array<{ url: string; description?: string }>;
  paths: Record<string, PathItem>;
  components?: {
    schemas?: Record<string, any>;
    parameters?: Record<string, any>;
    responses?: Record<string, any>;
  };
}

/** パスアイテム */
export interface PathItem {
  get?: OperationObject;
  post?: OperationObject;
  put?: OperationObject;
  patch?: OperationObject;
  delete?: OperationObject;
  options?: OperationObject;
  head?: OperationObject;
  parameters?: any[];
}

/** オペレーション */
export interface OperationObject {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: any[];
  requestBody?: any;
  responses: Record<string, any>;
}

/** バリデーション結果 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/** バリデーションエラー */
export interface ValidationError {
  path: string;
  message: string;
  errorCode?: string;
  location?: string;
  /** 実際の値 */
  actualValue?: unknown;
  /** 実際の型 */
  actualType?: string;
  /** 期待される型/値 */
  expected?: string;
  /** エラーメッセージのパラメータ（翻訳用） */
  params?: Record<string, string | number>;
}

/** HTTPメソッドの型 */
export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'options' | 'head';

/** リクエスト情報 */
export interface RequestInfo {
  method: HttpMethod;
  path: string;
  headers?: Record<string, string>;
  query?: Record<string, string | string[]>;
  body?: unknown;
}

/** レスポンス情報 */
export interface ResponseInfo {
  statusCode: number;
  headers?: Record<string, string>;
  body?: unknown;
}

// =============================================================================
// OpenAPIバリデータークラス
// =============================================================================

/**
 * OpenAPI仕様書に基づいてリクエスト・レスポンスを検証するクラス
 * evalを使用しないjsonschemaライブラリを使用
 */
export class OpenAPIValidator {
  private spec: OpenAPISpec;
  private resolvedSpec: OpenAPISpec;
  private jsonValidator: JsonSchemaValidator;

  /**
   * コンストラクタ
   * @param spec - パース済みのOpenAPI仕様書
   */
  constructor(spec: OpenAPISpec) {
    this.spec = spec;
    // $ref解決 → スキーマ変換（nullable対応など） → jsonschemaが落ちる原因の除去
    const resolved = this.resolveRefs(spec);
    const converted = this.convertSchemaForJsonSchema(resolved);
    this.resolvedSpec = this.sanitizeForJsonSchema(converted);
    this.jsonValidator = new JsonSchemaValidator();

    // コンポーネントスキーマを登録
    if (this.resolvedSpec.components?.schemas) {
      for (const [name, schema] of Object.entries(this.resolvedSpec.components.schemas)) {
        this.jsonValidator.addSchema(schema, `/components/schemas/${name}`);
      }
    }
  }

  /**
   * jsonschema が内部で new URL を呼ぶ際に落ちる原因となるフィールドを除去する。
   *
   * jsonschema の scan.js は schema の $id / id / $ref を URL として解釈する
   * （helpers.resolveUrl → new URL）。値に非ASCII（例: 日本語・キリル）や
   * 空白等が含まれると "Failed to construct 'URL': Invalid URL" を投げる。
   *
   * 本拡張ではバリデーション前に $ref はすべて展開済みなので、残骸として
   * 紛れ込んだ $id / id / $ref を一律で削除して安全側に倒す。
   */
  private sanitizeForJsonSchema(spec: OpenAPISpec): OpenAPISpec {
    const walk = (obj: unknown): unknown => {
      if (obj === null || typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) return obj.map(walk);
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        if (key === '$id' || key === 'id' || key === '$ref' || key === '$schema') continue;
        result[key] = walk(value);
      }
      return result;
    };
    return walk(spec) as OpenAPISpec;
  }

  /**
   * ファイル内容からOpenAPIValidatorを作成
   * @param content - ファイル内容（JSONまたはYAML）
   * @returns OpenAPIValidator インスタンス
   */
  static fromFile(content: string): OpenAPIValidator {
    const spec = parseOpenAPISpec(content);
    return new OpenAPIValidator(spec);
  }

  /**
   * $ref を再帰的に解決する
   */
  private resolveRefs(spec: OpenAPISpec): OpenAPISpec {
    const resolved = JSON.parse(JSON.stringify(spec)) as OpenAPISpec;
    const root = resolved as unknown as Record<string, unknown>;

    // "#/a/b/c" 形式の内部参照をルートから辿る
    const lookupInternalRef = (refPath: string): unknown => {
      if (!refPath.startsWith('#/')) return undefined;
      const parts = refPath
        .slice(2)
        .split('/')
        .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
      let cur: unknown = root;
      for (const part of parts) {
        if (cur === null || typeof cur !== 'object') return undefined;
        cur = (cur as Record<string, unknown>)[part];
        if (cur === undefined) return undefined;
      }
      return cur;
    };

    const resolveRef = (obj: unknown, depth = 0): unknown => {
      // 循環参照を防ぐため深さ制限
      if (depth > 20) {
        // 残った $ref は jsonschema が new URL で落ちる原因になるため除去
        if (obj && typeof obj === 'object' && !Array.isArray(obj) && '$ref' in obj) {
          return {};
        }
        return obj;
      }

      if (obj === null || typeof obj !== 'object') {
        return obj;
      }

      if (Array.isArray(obj)) {
        return obj.map((item) => resolveRef(item, depth + 1));
      }

      const record = obj as Record<string, unknown>;

      // $ref を解決
      if ('$ref' in record && typeof record.$ref === 'string') {
        const refPath = record.$ref;
        if (refPath.startsWith('#/')) {
          const target = lookupInternalRef(refPath);
          if (target && typeof target === 'object') {
            const expanded = { ...(target as Record<string, unknown>) };
            // 元のスキーマ名を title として保持（エラーメッセージで "[subschema N]" の代わりに使う）
            if (!expanded.title) {
              const segments = refPath.split('/');
              expanded.title = segments[segments.length - 1];
            }
            return resolveRef(expanded, depth + 1);
          }
        }
        // 外部参照や未解決の参照は jsonschema に渡すと new URL で例外を投げるため除去
        return {};
      }

      // 再帰的に処理
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(record)) {
        result[key] = resolveRef(value, depth + 1);
      }
      return result;
    };

    return resolveRef(resolved) as OpenAPISpec;
  }

  /**
   * OpenAPIスキーマをJSON Schema互換に変換
   * - nullable: true を type: ["original_type", "null"] に変換
   * - required でないプロパティに null を許容
   * - additionalProperties のデフォルト値を設定
   */
  private convertSchemaForJsonSchema(spec: OpenAPISpec): OpenAPISpec {
    const converted = JSON.parse(JSON.stringify(spec)) as OpenAPISpec;

    // { type: "null" } を表すスキーマかどうか
    const isNullSchema = (s: unknown): boolean => {
      if (!s || typeof s !== 'object') return false;
      const t = (s as Record<string, unknown>).type;
      return t === 'null' || (Array.isArray(t) && t.includes('null'));
    };

    /**
     * スキーマを変換
     * @param obj - 変換対象のスキーマ
     * @param isRequired - このプロパティがrequiredかどうか（trueならnull非許容）
     */
    const convertSchema = (obj: unknown, isRequired: boolean = true): unknown => {
      if (obj === null || typeof obj !== 'object') {
        return obj;
      }

      if (Array.isArray(obj)) {
        return obj.map((item) => convertSchema(item, true));
      }

      const record = obj as Record<string, unknown>;
      const result: Record<string, unknown> = {};

      // プロパティを処理
      for (const [key, value] of Object.entries(record)) {
        if (key === 'properties' && typeof value === 'object' && value !== null) {
          // properties 内のスキーマを変換（required 情報を確認）
          const requiredProps = (record.required as string[]) || [];
          const convertedProps: Record<string, unknown> = {};
          for (const [propName, propSchema] of Object.entries(value as Record<string, unknown>)) {
            // プロパティがrequiredに含まれているかどうか
            const propIsRequired = requiredProps.includes(propName);
            convertedProps[propName] = convertSchema(propSchema, propIsRequired);
          }
          result[key] = convertedProps;
        } else if (key === 'items' && typeof value === 'object') {
          // 配列のアイテムスキーマを変換（配列要素はrequired扱い）
          result[key] = convertSchema(value, true);
        } else if (key === 'allOf' || key === 'oneOf' || key === 'anyOf') {
          // 複合スキーマを変換
          if (Array.isArray(value)) {
            result[key] = value.map((item) => convertSchema(item, true));
          } else {
            result[key] = value;
          }
        } else {
          result[key] = value;
        }
      }

      // null許容の処理
      // 1. nullable: true が設定されている場合
      // 2. required でないプロパティの場合
      const shouldAllowNull = record.nullable === true || !isRequired;

      if (shouldAllowNull) {
        if (record.type) {
          // type がある場合は配列に "null" を追加
          const originalType = record.type;
          if (Array.isArray(originalType)) {
            if (!originalType.includes('null')) {
              result.type = [...originalType, 'null'];
            }
          } else {
            result.type = [originalType, 'null'];
          }
        } else if (Array.isArray(result.oneOf)) {
          // oneOf に { type: "null" } を追加
          if (!(result.oneOf as unknown[]).some((s) => isNullSchema(s))) {
            result.oneOf = [...(result.oneOf as unknown[]), { type: 'null' }];
          }
        } else if (Array.isArray(result.anyOf)) {
          if (!(result.anyOf as unknown[]).some((s) => isNullSchema(s))) {
            result.anyOf = [...(result.anyOf as unknown[]), { type: 'null' }];
          }
        } else if (Array.isArray(result.allOf)) {
          // allOf を anyOf 風に包む: { anyOf: [{ allOf: [...] }, { type: "null" }] }
          const allOfWrapped = { allOf: result.allOf, title: result.title };
          delete result.allOf;
          delete result.title;
          result.anyOf = [allOfWrapped, { type: 'null' }];
        }
      }

      // nullable プロパティを削除（JSON Schemaには不要）
      delete result.nullable;

      // OpenAPI 固有のプロパティを削除
      delete result.example;
      delete result.examples;
      delete result.xml;
      delete result.externalDocs;
      delete result.deprecated;
      delete result.discriminator;

      return result;
    };

    // paths 内のスキーマを変換
    if (converted.paths) {
      for (const pathItem of Object.values(converted.paths)) {
        for (const method of [
          'get',
          'post',
          'put',
          'patch',
          'delete',
          'options',
          'head',
        ] as const) {
          const operation = pathItem[method];
          if (operation) {
            // パラメータのスキーマを変換
            if (operation.parameters) {
              operation.parameters = operation.parameters.map((param: any) => {
                if (param.schema) {
                  // パラメータのrequired属性を確認
                  param.schema = convertSchema(param.schema, param.required ?? false);
                }
                return param;
              });
            }
            // リクエストボディのスキーマを変換
            if (operation.requestBody?.content) {
              for (const contentType of Object.keys(operation.requestBody.content)) {
                const content = operation.requestBody.content[contentType];
                if (content.schema) {
                  // リクエストボディのスキーマはトップレベルとしてrequired扱い
                  content.schema = convertSchema(content.schema, true);
                }
              }
            }
            // レスポンスのスキーマを変換
            if (operation.responses) {
              for (const responseCode of Object.keys(operation.responses)) {
                const response = operation.responses[responseCode];
                if (response?.content) {
                  for (const contentType of Object.keys(response.content)) {
                    const content = response.content[contentType];
                    if (content.schema) {
                      // レスポンススキーマはトップレベルとしてrequired扱い
                      content.schema = convertSchema(content.schema, true);
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    // components/schemas を変換
    if (converted.components?.schemas) {
      for (const schemaName of Object.keys(converted.components.schemas)) {
        // コンポーネントスキーマはトップレベルとしてrequired扱い
        converted.components.schemas[schemaName] = convertSchema(
          converted.components.schemas[schemaName],
          true,
        );
      }
    }

    return converted;
  }

  /**
   * パス文字列からOpenAPI仕様書のパスパターンにマッチするものを検索
   * @param actualPath - 実際のリクエストパス
   * @param method - 指定するとそのメソッドが定義されているパターンのみ候補にする
   *
   * 複数のパターンがマッチした場合、より具体的なもの（リテラルセグメントが多いもの）を優先する。
   * 例: "/users/me" は "/users/me" と "/users/{id}" の両方にマッチするが前者を選ぶ。
   */
  findMatchingPath(
    actualPath: string,
    method?: HttpMethod,
  ): { pattern: string; params: Record<string, string> } | null {
    let pathWithoutQuery = actualPath.split('?')[0];
    // trailing slash を正規化（ルート "/" はそのまま）
    if (pathWithoutQuery.length > 1 && pathWithoutQuery.endsWith('/')) {
      pathWithoutQuery = pathWithoutQuery.slice(0, -1);
    }

    type Candidate = {
      pattern: string;
      params: Record<string, string>;
      literalSegments: number;
      paramSegments: number;
    };
    const candidates: Candidate[] = [];

    for (const pattern of Object.keys(this.resolvedSpec.paths)) {
      const params = matchPath(pattern, pathWithoutQuery);
      if (params === null) continue;
      if (method && !this.resolvedSpec.paths[pattern][method]) continue;

      const segments = pattern.split('/').filter(Boolean);
      const paramSegments = segments.filter((s) => /^\{[^}]+\}$/.test(s)).length;
      const literalSegments = segments.length - paramSegments;
      candidates.push({ pattern, params, literalSegments, paramSegments });
    }

    if (candidates.length === 0) return null;

    // 優先順位: リテラルセグメントが多い → パラメータが少ない → パターン文字列が長い
    candidates.sort((a, b) => {
      if (b.literalSegments !== a.literalSegments) return b.literalSegments - a.literalSegments;
      if (a.paramSegments !== b.paramSegments) return a.paramSegments - b.paramSegments;
      return b.pattern.length - a.pattern.length;
    });

    return { pattern: candidates[0].pattern, params: candidates[0].params };
  }

  /**
   * リクエストを検証
   */
  validateRequest(request: RequestInfo): ValidationResult {
    const errors: ValidationError[] = [];

    // メソッド付きで一致するパターンを優先的に探し、無ければ method 抜きで探す
    const matched =
      this.findMatchingPath(request.path, request.method) ?? this.findMatchingPath(request.path);
    if (!matched) {
      return {
        valid: false,
        errors: [
          {
            path: request.path,
            message: `Path "${request.path}" is not defined in OpenAPI spec`,
            errorCode: 'PATH_NOT_FOUND',
            params: { path: request.path },
          },
        ],
      };
    }

    const { pattern, params } = matched;
    const pathItem = this.resolvedSpec.paths[pattern];
    const operation = pathItem[request.method];

    if (!operation) {
      return {
        valid: false,
        errors: [
          {
            path: request.path,
            message: `Method "${request.method.toUpperCase()}" is not defined for path "${pattern}"`,
            errorCode: 'METHOD_NOT_ALLOWED',
            params: { method: request.method.toUpperCase(), path: pattern },
          },
        ],
      };
    }

    // パラメータをマージ
    const allParameters = [...(pathItem.parameters || []), ...(operation.parameters || [])];

    // クエリパラメータを抽出
    const queryString = request.path.split('?')[1] || '';
    const queryParams = parseQueryString(queryString);

    // パスパラメータの検証
    this.validateParameters(allParameters, 'path', params, errors);

    // クエリパラメータの検証
    this.validateParameters(allParameters, 'query', { ...queryParams, ...request.query }, errors);

    // ヘッダーパラメータの検証
    this.validateParameters(allParameters, 'header', request.headers || {}, errors);

    // リクエストボディの検証
    if (operation.requestBody) {
      const contentType = 'application/json';
      const bodySchema = operation.requestBody?.content?.[contentType]?.schema;

      if (bodySchema) {
        if (
          operation.requestBody.required &&
          (request.body === undefined || request.body === null)
        ) {
          errors.push({
            path: 'body',
            message: 'Request body is required',
            errorCode: 'REQUIRED_BODY',
            location: 'body',
          });
        } else if (request.body !== undefined && request.body !== null) {
          this.validateSchema(request.body, bodySchema, 'body', errors);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * レスポンスを検証
   */
  validateResponse(request: RequestInfo, response: ResponseInfo): ValidationResult {
    const errors: ValidationError[] = [];

    const matched =
      this.findMatchingPath(request.path, request.method) ?? this.findMatchingPath(request.path);
    if (!matched) {
      return {
        valid: false,
        errors: [
          {
            path: request.path,
            message: `Path "${request.path}" is not defined in OpenAPI spec`,
            errorCode: 'PATH_NOT_FOUND',
            params: { path: request.path },
          },
        ],
      };
    }

    const { pattern } = matched;
    const pathItem = this.resolvedSpec.paths[pattern];
    const operation = pathItem[request.method];

    if (!operation) {
      return {
        valid: false,
        errors: [
          {
            path: request.path,
            message: `Method "${request.method.toUpperCase()}" is not defined for path "${pattern}"`,
            errorCode: 'METHOD_NOT_ALLOWED',
            params: { method: request.method.toUpperCase(), path: pattern },
          },
        ],
      };
    }

    // ステータスコードに対応するレスポンス定義を取得
    const statusCode = String(response.statusCode);
    const responseSpec =
      operation.responses[statusCode] ||
      operation.responses[`${statusCode[0]}XX`] ||
      operation.responses['default'];

    if (!responseSpec) {
      errors.push({
        path: request.path,
        message: `Status code ${response.statusCode} is not defined for "${request.method.toUpperCase()}" "${pattern}"`,
        errorCode: 'UNEXPECTED_STATUS_CODE',
        params: {
          statusCode: response.statusCode,
          method: request.method.toUpperCase(),
          path: pattern,
        },
      });
      return { valid: false, errors };
    }

    // 204 No Content の場合
    if (response.statusCode === 204) {
      if (response.body !== undefined && response.body !== null && response.body !== '') {
        errors.push({
          path: request.path,
          message: '204 No Content response should not contain a body',
          errorCode: 'UNEXPECTED_BODY',
        });
      }
      return { valid: errors.length === 0, errors };
    }

    // レスポンスボディのスキーマを取得
    const contentType = 'application/json';
    const responseContent = responseSpec.content?.[contentType];

    if (responseContent?.schema && response.body !== undefined) {
      this.validateSchema(response.body, responseContent.schema, 'response', errors);
    }

    // レスポンスヘッダーの検証
    this.validateResponseHeaders(responseSpec.headers, response.headers || {}, errors);

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * パラメータを検証
   */
  private validateParameters(
    parameters: any[],
    location: 'path' | 'query' | 'header',
    values: Record<string, any>,
    errors: ValidationError[],
  ): void {
    const locationParams = parameters.filter((p) => p.in === location);

    for (const param of locationParams) {
      const value = values[param.name];

      // 必須チェック
      if (param.required && (value === undefined || value === '')) {
        errors.push({
          path: param.name,
          message: `Required parameter "${param.name}" is missing`,
          errorCode: 'REQUIRED_PARAM',
          location,
          params: { name: param.name },
        });
        continue;
      }

      // スキーマチェック
      if (value !== undefined && value !== '' && param.schema) {
        // 型変換（クエリパラメータは文字列で来るため）
        let convertedValue = value;
        if (param.schema.type === 'integer' || param.schema.type === 'number') {
          const num = Number(value);
          if (!isNaN(num)) {
            convertedValue = num;
          }
        } else if (param.schema.type === 'boolean') {
          convertedValue = value === 'true' || value === true;
        }

        this.validateSchema(convertedValue, param.schema, param.name, errors);
      }
    }
  }

  /**
   * レスポンスヘッダーを検証
   * OpenAPI仕様書のresponses.{code}.headersに基づいて検証
   */
  private validateResponseHeaders(
    headerSpecs: Record<string, any> | undefined,
    actualHeaders: Record<string, string>,
    errors: ValidationError[],
  ): void {
    if (!headerSpecs) {
      return;
    }

    // ヘッダー名を小文字に正規化したマップを作成
    const normalizedHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(actualHeaders)) {
      normalizedHeaders[key.toLowerCase()] = value;
    }

    for (const [headerName, headerSpec] of Object.entries(headerSpecs)) {
      const normalizedName = headerName.toLowerCase();
      const value = normalizedHeaders[normalizedName];

      // 必須チェック
      if (headerSpec.required && (value === undefined || value === '')) {
        errors.push({
          path: `header.${headerName}`,
          message: `Required response header "${headerName}" is missing`,
          errorCode: 'REQUIRED_HEADER',
          location: 'header',
          params: { name: headerName },
        });
        continue;
      }

      // スキーマチェック
      if (value !== undefined && value !== '' && headerSpec.schema) {
        // 型変換（ヘッダーは文字列で来るため）
        let convertedValue: unknown = value;
        if (headerSpec.schema.type === 'integer' || headerSpec.schema.type === 'number') {
          const num = Number(value);
          if (!isNaN(num)) {
            convertedValue = num;
          }
        } else if (headerSpec.schema.type === 'boolean') {
          convertedValue = value === 'true';
        }

        this.validateSchema(convertedValue, headerSpec.schema, `header.${headerName}`, errors);
      }
    }
  }

  /**
   * JSONスキーマでバリデーション
   */
  private validateSchema(
    value: unknown,
    schema: any,
    path: string,
    errors: ValidationError[],
  ): void {
    try {
      const result = this.jsonValidator.validate(value, schema);

      if (!result.valid) {
        for (const error of result.errors) {
          // 期待される型/値を取得
          let expected = '';
          if (error.argument) {
            if (Array.isArray(error.argument)) {
              expected = error.argument.join(', ');
            } else {
              expected = String(error.argument);
            }
          } else if (error.schema && typeof error.schema === 'object') {
            const schema = error.schema as Record<string, unknown>;
            if (schema.type) {
              expected = Array.isArray(schema.type) ? schema.type.join(' | ') : String(schema.type);
            } else if (schema.enum && Array.isArray(schema.enum)) {
              expected = schema.enum.join(' | ');
            }
          }

          // oneOf/anyOf/allOf エラーの場合、subschema の中身を人間可読に展開
          let message = error.message;
          if (
            error.schema &&
            typeof error.schema === 'object' &&
            (error.name === 'oneOf' || error.name === 'anyOf' || error.name === 'allOf')
          ) {
            const sch = error.schema as Record<string, unknown>;
            const subs = sch[error.name] as unknown[] | undefined;
            if (Array.isArray(subs)) {
              const labels = subs.map((s) => this.describeSubschema(s));
              expected = labels.join(' | ');
              const actualType = this.getTypeName(error.instance);
              message = `value (${actualType}) does not match any of: ${labels.join(' | ')}`;
            }
          }

          errors.push({
            path: error.property ? `${path}.${error.property.replace('instance.', '')}` : path,
            message,
            errorCode: error.name,
            location: path,
            actualValue: error.instance,
            actualType: this.getTypeName(error.instance),
            expected: expected || undefined,
          });
        }
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const isUrlError = raw.includes('Failed to construct');
      errors.push({
        path,
        message: isUrlError
          ? `Unresolved $ref remains in the schema (${raw})`
          : `Error during schema validation: ${raw}`,
        errorCode: isUrlError ? 'UNRESOLVED_REF' : 'VALIDATION_ERROR',
        params: { detail: raw },
      });
    }
  }

  /**
   * 値の型名を取得
   */
  private getTypeName(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }

  /**
   * サブスキーマを人間可読なラベルに変換する
   * 例: { title: "BonusAuthorObject", type: "object" } → "BonusAuthorObject"
   *     { type: "null" } → "null"
   *     { type: "string", enum: ["a","b"] } → "string(a | b)"
   *     { oneOf: [...] } → "(A | B)"
   */
  private describeSubschema(s: unknown): string {
    if (s === null || typeof s !== 'object') return 'unknown';
    const sch = s as Record<string, unknown>;
    if (typeof sch.title === 'string' && sch.title) return sch.title;
    if (sch.type !== undefined) {
      const t = Array.isArray(sch.type) ? sch.type.join(' | ') : String(sch.type);
      if (Array.isArray(sch.enum)) return `${t}(${sch.enum.join(' | ')})`;
      return t;
    }
    if (Array.isArray(sch.enum)) return sch.enum.map((v) => JSON.stringify(v)).join(' | ');
    for (const key of ['oneOf', 'anyOf', 'allOf'] as const) {
      const sub = sch[key];
      if (Array.isArray(sub)) {
        return `(${sub.map((x) => this.describeSubschema(x)).join(' | ')})`;
      }
    }
    if (typeof sch.$ref === 'string') {
      const seg = sch.$ref.split('/');
      return seg[seg.length - 1];
    }
    return 'object';
  }

  /**
   * 読み込んだ仕様書を取得
   */
  getSpec(): OpenAPISpec {
    return this.spec;
  }

  /**
   * $ref解決済みの仕様書を取得
   */
  getResolvedSpec(): OpenAPISpec {
    return this.resolvedSpec;
  }

  /**
   * 仕様書に定義されているパスパターンの一覧を取得
   */
  getPathPatterns(): string[] {
    return Object.keys(this.resolvedSpec.paths);
  }

  /**
   * パスとメソッドの組み合わせが仕様書に定義されているかを確認
   * @param actualPath - 実際のリクエストパス（クエリ文字列を含んでも可）
   * @param method - HTTPメソッド（小文字）
   * @returns マッチする場合はtrue、しない場合はfalse
   */
  hasOperation(actualPath: string, method: HttpMethod): boolean {
    // method を渡すことで、別パターンにマッチして method 不一致になる誤判定を防ぐ
    return this.findMatchingPath(actualPath, method) !== null;
  }
}

// =============================================================================
// ユーティリティ関数
// =============================================================================

/**
 * OpenAPI仕様書の文字列をパースする
 */
export function parseOpenAPISpec(content: string): OpenAPISpec {
  const trimmed = content.trim();

  if (trimmed.startsWith('{')) {
    return JSON.parse(content) as OpenAPISpec;
  } else {
    return yaml.load(content, { schema: yaml.JSON_SCHEMA }) as OpenAPISpec;
  }
}

/**
 * パスパターンと実際のパスをマッチング（セグメント単位の後方一致）
 *
 * パターンのセグメント数と末尾から同じだけのセグメントが完全一致する必要がある。
 * これにより BaseURL を含むパスもマッチするが、パターンより細かいパスや、
 * セグメント境界をまたぐ部分一致は除外される。
 *
 * 例:
 *   "/auth"          は "/api/v1/auth"            にマッチ（末尾1セグメント "auth" が一致）
 *   "/auth"          は "/api/auth/login"         にマッチしない（末尾は "login"）
 *   "/users/{id}"    は "/api/v1/users/27"        にマッチ
 *   "/assets/{name}" は "/src/shared/api/v0/assets/index.ts" にマッチしない
 *                       （"/assets" の前にも実パスのセグメントがあるが末尾2セグメントは
 *                        "assets/index.ts" — 末尾セグメント数は合うのでマッチする）
 *
 * 注: 上の最後の例は実際にはマッチする。完全に防ぐにはサーバURLを考慮する必要があるが、
 * 少なくとも "/auth" 1セグメントのパターンが任意の深いパスを誤って拾うことは防げる。
 */
export function matchPath(pattern: string, actualPath: string): Record<string, string> | null {
  const patternSegments = pattern.split('/').filter((s) => s.length > 0);
  const actualSegments = actualPath.split('/').filter((s) => s.length > 0);

  // 実パスはパターンと同じか、それより長い前置パス（BaseURL等）を含むことを許容
  if (actualSegments.length < patternSegments.length) {
    return null;
  }

  // 末尾から patternSegments.length 個のセグメントを取り出す
  const tailSegments = actualSegments.slice(actualSegments.length - patternSegments.length);

  const params: Record<string, string> = {};
  for (let i = 0; i < patternSegments.length; i++) {
    const ps = patternSegments[i];
    const as = tailSegments[i];
    const paramMatch = ps.match(/^\{([^}]+)\}$/);
    if (paramMatch) {
      // パラメータセグメント: 任意の値（空でない）を許容
      if (as.length === 0) return null;
      params[paramMatch[1]] = decodeURIComponent(as);
    } else if (ps !== as) {
      // リテラルセグメント: 完全一致が必要
      return null;
    }
  }

  return params;
}

/**
 * クエリ文字列をパース
 */
export function parseQueryString(queryString: string): Record<string, string> {
  const params: Record<string, string> = {};

  if (!queryString) {
    return params;
  }

  const pairs = queryString.split('&');
  for (const pair of pairs) {
    const [key, value] = pair.split('=');
    if (key) {
      params[decodeURIComponent(key)] = value ? decodeURIComponent(value) : '';
    }
  }

  return params;
}

/**
 * Content-Typeヘッダーからメディアタイプを抽出
 */
export function extractMediaType(contentType: string | undefined): string {
  if (!contentType) {
    return 'application/json';
  }
  return contentType.split(';')[0].trim();
}

