export interface PageMeta {
  page: number;
  pageSize: number;
  totalCount: number | null;
  totalPages: number | null;
}

export interface Paged<T> {
  items: ReadonlyArray<T>;
  meta: PageMeta;
}

export type QueryParam = string | number | boolean | null | undefined;
export type QueryParams = Readonly<Record<string, QueryParam>>;
