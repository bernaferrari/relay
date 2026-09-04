export declare const PRODUCT_V2_ROUTES: readonly string[];
export declare const PRODUCT_V2_PUBLIC_OBJECTS: readonly string[];
export declare const PRODUCT_V2_ADVANCED_TERMS: readonly string[];
export declare const PRODUCT_V2_OVERLAY_PRIORITY: readonly string[];
export declare const PRODUCT_V2_NARROW_WINDOW: {
  readonly width: number;
  readonly height: number;
  readonly noHorizontalScroll: boolean;
};
export declare function findProductV2AdvancedVocabulary(source?: string): string[];
export declare function evaluateProductV2Contract(input?: {
  document?: string;
  routes?: readonly string[];
  publicObjects?: readonly string[];
  advancedTerms?: readonly string[];
}): string[];
export declare function loadProductV2Contract(root?: string): Promise<string>;
