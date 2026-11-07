// ADR-072 / PROD-01: retain document invalidation across every Pro await.
export const PRO_CURRENT_BEFORE = '          return this.proValueControlEpoch === controlEpoch && this.checkDeadline() && this.session.id === sessionId && this.runtime.scope.accessGeneration === generation && this.pageFor(binding.tabId) === page && live?.documentId === binding.documentId && live?.tabId === binding.tabId && live?.frameId === binding.frameId && live.documentLifecycle !== "cached" && live.documentLifecycle !== "prerender" && this.belongsToPage(binding.documentKey, page);';
export const PRO_CURRENT_AFTER = `          // ADR-072: a pause followed by resume still invalidates this operation.
          const meta = this.runtime.state.metas?.get(binding.documentKey);
          return !operation.invalid && !meta?.paused && !meta?.revoked && meta?.accessGranted !== false && live?.accessGranted !== false && !live?.originPending && this.runtime.scope.accessReady !== false && this.proValueControlEpoch === controlEpoch && this.checkDeadline() && this.session.id === sessionId && this.runtime.scope.accessGeneration === generation && this.pageFor(binding.tabId) === page && live?.documentId === binding.documentId && live?.tabId === binding.tabId && live?.frameId === binding.frameId && live.documentLifecycle !== "cached" && live.documentLifecycle !== "prerender" && this.belongsToPage(binding.documentKey, page);`;
const registrationBefore = '        const page = this.pageFor(binding.tabId), request = { tabId: binding.tabId, frameId: binding.frameId, documentKey: binding.documentKey }, operation = { documentKey: binding.documentKey, tabId: binding.tabId, invalid: !1 };';
const registrationAfter = registrationBefore + `
        if (!this.runtime.apiResults.trackOperation(operation)) { this.limit("event-limit"); continue; }
        try {`;
const releaseBefore = '        this.mark();\n      }\n    } finally {\n      this.proValueBusy = !1;';
const releaseAfter = '        this.mark();\n        } finally { this.runtime.apiResults.releaseOperation(operation); }\n      }\n    } finally {\n      this.proValueBusy = !1;';
const authorizeBefore = '    return await this.runtime.scope.isGranted(scheme + "://" + host2 + "/*", request.tabId, binding.documentId) && !operation.invalid && generation === this.runtime.scope.accessGeneration && this.runtime.scope.accessReady && this.binding(request.documentKey)?.documentId === binding.documentId;';
const authorizeAfter = `    const granted = await this.runtime.scope.isGranted(scheme + "://" + host2 + "/*", request.tabId, binding.documentId);
    const live = this.binding(request.documentKey), currentMeta = this.runtime.state.metas.get(request.documentKey), currentProjection = this.runtime.getProjection(request.tabId, request.frameId);
    return granted && !operation.invalid && generation === this.runtime.scope.accessGeneration && this.runtime.scope.accessReady && live?.documentId === binding.documentId && live.accessGranted !== false && !live.originPending && !currentMeta?.paused && !currentMeta?.revoked && currentMeta?.accessGranted !== false && currentProjection?.documentKey === request.documentKey && currentProjection.coverageState !== "paused" && currentProjection.coverageState !== "no-access";`;
const methods = `  // ADR-072: UI operations and Pro share the same bounded invalidation ledger.
  trackOperation(operation) {
    if (this.operations.has(operation)) return !operation.invalid;
    if (this.operations.size >= 8 || operation.invalid) return !1;
    this.operations.add(operation); return !0;
  }
  releaseOperation(operation) { this.operations.delete(operation); }
`;
function replaceOnce(source,before,after,label) {
 if(source.includes(after))return source;
 const first=source.indexOf(before);if(first<0||source.indexOf(before,first+before.length)>=0)throw Error(label+': expected one source boundary');
 return source.slice(0,first)+after+source.slice(first+before.length);
}
export function patchProDocumentLifecycle(source,name) {
 if(name==='background.js'){
  source=replaceOnce(source,PRO_CURRENT_BEFORE,PRO_CURRENT_AFTER,name+' current');
  source=replaceOnce(source,registrationBefore,registrationAfter,name+' operation registration');
  source=replaceOnce(source,releaseBefore,releaseAfter,name+' operation release');
 }
 if(name==='background.js'){
  const start=source.indexOf('ApiResultsManager = class {'),end=source.indexOf('// packages/background/src/response-headers.ts',start);
  if(start<0||end<=start)throw Error(name+': ApiResultsManager boundary');
  let block=source.slice(start,end);
  block=replaceOnce(block,authorizeBefore,authorizeAfter,name+' authorize');
  if(!block.includes(methods))block=replaceOnce(block,'  invalidate(documentKey3) {',methods+'  invalidate(documentKey3) {',name+' ledger');
  source=source.slice(0,start)+block+source.slice(end);
 }
 return source;
}
