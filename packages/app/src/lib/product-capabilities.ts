/**
 * Product capabilities that may be removed or rolled out independently.
 *
 * Keep these separate from persisted settings: changing a capability must not
 * rewrite recordings or recipes. Flip this one value to hide and disable the
 * recorded-screen sibling/other-element picker while retaining captured UI
 * tree evidence for previews and future tooling.
 */
export const RECORDED_OTHER_ELEMENT_PICKING = true;
