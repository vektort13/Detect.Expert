// WebGL getParameter pname classification for DET-011 (E07-03, S04; ADR-017 §2). Pure integer comparisons on a
// primitive number the observer already checked with `typeof`: no coercion, no lookup in a page-reachable table.
// The pname itself and the value the browser returns are never recorded, only the category code.
//
// Literal values: enumerated once from WebGLRenderingContext and WebGL2RenderingContext constants in Chromium
// 153.0.8010.12 (2026-10-17, 298 / 553 numeric constants), selecting names /^MAX_/, MIN_PROGRAM_TEXEL_OFFSET,
// /^ALIASED_/ and /_BITS$/ (48 values, no collision with a non-limit constant), plus 0x84FF
// MAX_TEXTURE_MAX_ANISOTROPY_EXT (EXT_texture_filter_anisotropic). Other extension limits are `param-other`.
// tests/extension/webgl.spec.ts re-checks the list against the browser's constants.

/** Identity pnames with their own operation code (WebGL 1 core + WEBGL_debug_renderer_info). */
export const WEBGL_IDENTITY_PARAMS = Object.freeze({
  VENDOR: 0x1f00,
  RENDERER: 0x1f01,
  VERSION: 0x1f02,
  SHADING_LANGUAGE_VERSION: 0x8b8c,
  UNMASKED_VENDOR_WEBGL: 0x9245,
  UNMASKED_RENDERER_WEBGL: 0x9246,
});

/** True for an implementation-limit pname (`param-limit`). */
export function isLimitParam(p: number): boolean {
  switch (p) {
    // WebGL 1
    case 0x0d33: // MAX_TEXTURE_SIZE
    case 0x0d3a: // MAX_VIEWPORT_DIMS
    case 0x0d50: // SUBPIXEL_BITS
    case 0x0d52: // RED_BITS
    case 0x0d53: // GREEN_BITS
    case 0x0d54: // BLUE_BITS
    case 0x0d55: // ALPHA_BITS
    case 0x0d56: // DEPTH_BITS
    case 0x0d57: // STENCIL_BITS
    case 0x846d: // ALIASED_POINT_SIZE_RANGE
    case 0x846e: // ALIASED_LINE_WIDTH_RANGE
    case 0x84e8: // MAX_RENDERBUFFER_SIZE
    case 0x851c: // MAX_CUBE_MAP_TEXTURE_SIZE
    case 0x8869: // MAX_VERTEX_ATTRIBS
    case 0x8872: // MAX_TEXTURE_IMAGE_UNITS
    case 0x8b4c: // MAX_VERTEX_TEXTURE_IMAGE_UNITS
    case 0x8b4d: // MAX_COMBINED_TEXTURE_IMAGE_UNITS
    case 0x8dfb: // MAX_VERTEX_UNIFORM_VECTORS
    case 0x8dfc: // MAX_VARYING_VECTORS
    case 0x8dfd: // MAX_FRAGMENT_UNIFORM_VECTORS
    // WebGL 2
    case 0x8073: // MAX_3D_TEXTURE_SIZE
    case 0x80e8: // MAX_ELEMENTS_VERTICES
    case 0x80e9: // MAX_ELEMENTS_INDICES
    case 0x84fd: // MAX_TEXTURE_LOD_BIAS
    case 0x8824: // MAX_DRAW_BUFFERS
    case 0x88ff: // MAX_ARRAY_TEXTURE_LAYERS
    case 0x8904: // MIN_PROGRAM_TEXEL_OFFSET
    case 0x8905: // MAX_PROGRAM_TEXEL_OFFSET
    case 0x8a2b: // MAX_VERTEX_UNIFORM_BLOCKS
    case 0x8a2d: // MAX_FRAGMENT_UNIFORM_BLOCKS
    case 0x8a2e: // MAX_COMBINED_UNIFORM_BLOCKS
    case 0x8a2f: // MAX_UNIFORM_BUFFER_BINDINGS
    case 0x8a30: // MAX_UNIFORM_BLOCK_SIZE
    case 0x8a31: // MAX_COMBINED_VERTEX_UNIFORM_COMPONENTS
    case 0x8a33: // MAX_COMBINED_FRAGMENT_UNIFORM_COMPONENTS
    case 0x8b49: // MAX_FRAGMENT_UNIFORM_COMPONENTS
    case 0x8b4a: // MAX_VERTEX_UNIFORM_COMPONENTS
    case 0x8b4b: // MAX_VARYING_COMPONENTS
    case 0x8c80: // MAX_TRANSFORM_FEEDBACK_SEPARATE_COMPONENTS
    case 0x8c8a: // MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS
    case 0x8c8b: // MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS
    case 0x8cdf: // MAX_COLOR_ATTACHMENTS
    case 0x8d57: // MAX_SAMPLES
    case 0x8d6b: // MAX_ELEMENT_INDEX
    case 0x9111: // MAX_SERVER_WAIT_TIMEOUT
    case 0x9122: // MAX_VERTEX_OUTPUT_COMPONENTS
    case 0x9125: // MAX_FRAGMENT_INPUT_COMPONENTS
    case 0x9247: // MAX_CLIENT_WAIT_TIMEOUT_WEBGL
    // Extension
    case 0x84ff: // MAX_TEXTURE_MAX_ANISOTROPY_EXT
      return true;
    default:
      return false;
  }
}
