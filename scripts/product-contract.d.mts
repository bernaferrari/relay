export declare const PRODUCT_ROUTES: readonly string[];
export declare const PRODUCT_PUBLIC_OBJECTS: readonly string[];
export declare const PRODUCT_ADVANCED_TERMS: readonly string[];
export declare const PRODUCT_OVERLAY_PRIORITY: readonly string[];
export declare const PRODUCT_NARROW_WINDOW: {
  readonly width: number;
  readonly height: number;
  readonly noHorizontalScroll: boolean;
};
export declare function findProductAdvancedVocabulary(source?: string): string[];
export declare function evaluateProductContract(input?: {
  document?: string;
  routes?: readonly string[];
  publicObjects?: readonly string[];
  advancedTerms?: readonly string[];
}): string[];
export declare function loadProductContract(root?: string): Promise<string>;
