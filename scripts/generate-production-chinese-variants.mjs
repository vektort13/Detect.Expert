// Written regional variants share the technical Chinese vocabulary. Grammar and UI phrases are
// maintained locally; this script performs no network requests and never falls back to English.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { applyProTechnicalCopy } from './production-locale-corrections.mjs';
import { EXTENSION_NAME } from './production-languages.mjs';

const directory = resolve('apps/production-extension');
const reference = applyProTechnicalCopy(JSON.parse(await readFile(resolve(directory, '_locales/zh_CN/messages.json'), 'utf8')), 'zh_CN');

const GLOSSARIES = {
  yue: [
    ['目的', '\uE000'], ['存在', '\uE001'], ['涉及', '\uE002'], ['因此', '所以'], ['此外', '另外'],
    ['不可用', '用唔到'], ['不受支持', '唔支援'], ['不支持', '唔支援'], ['无法', '冇办法'], ['无权', '冇权限'],
    ['没有', '冇'], ['并非', '唔系'], ['而非', '唔系'], ['是否', '系咪'], ['不是', '唔系'], ['不能', '唔可以'],
    ['不足', '唔够'], ['无需', '唔使'], ['不会', '唔会'], ['不存在', '唔存在'], ['不', '唔'],
    ['正在', '而家喺度'], ['现在', '而家'], ['当前', '而家嘅'], ['已经', '已经'], ['您的', '你嘅'], ['您', '你'],
    ['这些', '呢啲'], ['这个', '呢个'], ['本次', '今次'], ['此次', '今次'], ['此处', '呢度'], ['此', '呢个'], ['其值', '佢嘅值'],
    ['若要', '如果想'], ['以及', '同埋'], ['及', '同'], ['和', '同'], ['与', '同'], ['仅', '净系'], ['仍', '仲'],
    ['将', '会'], ['是', '系'], ['数据', '资料'], ['存储', '储存'], ['重新加载', '重新载入'], ['请', '请'], ['的', '嘅'],
    ['\uE000', '目的'], ['\uE001', '存在'], ['\uE002', '涉及'],
  ],
  wuu: [
    ['目的', '\uE000'], ['存在', '\uE001'], ['涉及', '\uE002'], ['因此', '所以'], ['此外', '另外'],
    ['不可用', '用勿来'], ['不受支持', '勿支持'], ['不支持', '勿支持'], ['无法', '呒办法'], ['无权', '呒权限'],
    ['没有', '呒没'], ['并非', '勿是'], ['而非', '勿是'], ['是否', '是不是'], ['不是', '勿是'], ['不能', '勿能'],
    ['无需', '勿需要'], ['不会', '勿会'], ['不足', '勿够'], ['不', '勿'],
    ['正在', '勒浪'], ['现在', '现在'], ['当前', '眼前'], ['这些', '迭些'], ['这个', '迭个'], ['此', '迭个'],
    ['您的', '侬个'], ['您', '侬'], ['自己', '自家'], ['若要', '要是想'], ['如果', '要是'],
    ['以及', '搭仔'], ['及', '搭'], ['和', '搭'], ['与', '搭'], ['仅', '只'], ['仍', '还是'], ['的', '个'],
    ['\uE000', '目的'], ['\uE001', '存在'], ['\uE002', '涉及'],
  ],
};

const OVERRIDES = {
  yue: {
    extDescription: '喺本地分析浏览器 API、数字指纹迹象同身份识别服务，可以自订 API 拦截规则。',
    actionTitle: 'Detect.Expert：浏览器 API 分析',
    popupTitle: '呢个网页嘅检查', sidepanelTitle: '呢个网页嘅观察结果', optionsTitle: 'Detect.Expert 设置',
    consent_title: '本地资料处理', consent_enable: '开启本地分析', consent_decline: '继续关闭观察',
    consent_revoke: '撤回同意同清除会话', consent_error: '确认唔到同意。观察仲未用得，请再试。',
    scopeLabel: '观察范围', scope_start_title: '想观察边啲范围？', scope_start_hint: '请喺下面拣观察范围。',
    mode_off: '关闭', mode_active_tab: '由而家开始检查', mode_site: '一直观察呢个网站', mode_all: '观察全部网站',
    scopeSite: '一直观察呢个网站', scopeActiveTab: '由而家开始观察呢个分页', scopeAllSites: '观察全部网站',
    scopeOff: '关闭', statusLoading: '载入紧…', statusUnavailable: '用唔到',
    coverage_active_title: '观察紧', coverage_paused_title: '观察已暂停', coverage_late_start_title: '观察开始得迟',
    coverage_no_access_title: '冇权限进入呢个网页', coverage_unsupported_title: '呢个网页观察唔到',
    status_active: '观察紧', status_partial: '部分', status_late_start: '开始得迟', status_paused: '暂停咗',
    status_unsupported: '用唔到', status_no_access: '冇权限', status_degraded: '受限制', status_no_report: '未有报告',
    language_label: '介面语言', language_change_failed: '储存唔到语言选择。请再试。',
    action_pause: '暂停呢份文件嘅观察', action_resume: '继续观察', action_refresh: '更新', action_apply: '套用',
    action_cancel: '取消', action_dismiss: '关闭', open_options: '设置', open_sidepanel: '打开侧边栏',
    action_reload_page: '重新载入网页', action_reload: '重新载入，由头分析', action_clear: '删除呢份文件嘅报告',
    report_title: '浏览过程分析报告', report_save: '另存为 PDF', report_page: '网页', report_pages: '网页',
    report_summary: '摘要', report_requests: '睇到嘅请求', report_duration: '历时', report_first_seen: '第一次睇到',
    report_last_seen: '最后一次睇到', report_no_resources: '呢个网页未有捕获到资源请求。',
    pro_title: '网域录制', pro_start: '开始录制', pro_stop: '停止录制', pro_recording: '录制紧',
    pro_stopped: '录制停止咗', pro_report_ready: '报告准备好咗', pro_report_open: '打开报告',
    api_results_title: '最近嘅结果',
    api_results_note: '最近观察到嘅结果。Pro 录制运行紧嗰阵，拣咗嘅技术参数同唔同嘅返回值会储存喺本地报告入面。',
    consent_previews: '本地预览可以复制网页已经读取嘅 Canvas/WebGL 图像、精确嘅技术 API 值、WebRTC 证书指纹同 Google X-Client-Data。图像同网页标题可能包含个人或者敏感资料。图像、Google 标头同证书预览净系留喺有容量限制嘅内存入面，唔会进入 Chrome 储存、Pro/PDF 或者导出。Pro 录制运行紧嗰阵，拣咗嘅技术 API 参数同唔同嘅返回值会储存喺本地报告入面。',
    permission_result_prompt: 'prompt 状态／仲未获准', permission_name_camera: '相机', permission_name_microphone: '咪高峰',
    badge_tooltip: '呢个分页同佢嘅框架入面观察到嘅技术数：$N$',
  },
  wuu: {
    extDescription: '勒本地分析浏览器 API、数字指纹迹象搭身份识别服务，可以自定义 API 阻止规则。',
    actionTitle: 'Detect.Expert：浏览器 API 分析',
    popupTitle: '迭个网页上个检查', sidepanelTitle: '迭个网页上个观察结果', optionsTitle: 'Detect.Expert 设置',
    consent_title: '本地数据处理', consent_enable: '开启本地分析', consent_decline: '观察还是关牢',
    consent_revoke: '撤回同意搭清除会话', consent_error: '同意确认勿了。观察还是用勿来，请再试一趟。',
    scopeLabel: '观察范围', scope_start_title: '想观察啥范围？', scope_start_hint: '请勒下头挑观察范围。',
    mode_off: '关牢', mode_active_tab: '从现在开始检查', mode_site: '一直观察迭个网站', mode_all: '观察全部网站',
    scopeOff: '关牢', scopeSite: '一直观察迭个网站', scopeActiveTab: '从现在观察迭个标签页', scopeAllSites: '观察全部网站',
    statusLoading: '勒浪加载…', statusUnavailable: '用勿来', coverage_active_title: '勒浪观察',
    coverage_paused_title: '观察暂停了', coverage_late_start_title: '观察开始得晏',
    coverage_no_access_title: '呒权限访问迭个网页', coverage_unsupported_title: '迭个网页观察勿了',
    status_active: '勒浪观察', status_partial: '部分', status_late_start: '开始得晏', status_paused: '暂停了',
    status_unsupported: '用勿来', status_no_access: '呒权限', status_degraded: '有限制', status_no_report: '呒没报告',
    language_label: '界面语言', language_change_failed: '语言选择存勿下来。请再试一趟。',
    action_pause: '暂停迭份文档个观察', action_resume: '继续观察', action_refresh: '更新', action_apply: '应用',
    action_cancel: '取消', action_dismiss: '关牢', open_options: '设置', open_sidepanel: '打开侧边栏',
    action_reload_page: '重新加载网页', action_reload: '重新加载，从头分析', action_clear: '删脱迭份文档个报告',
    report_title: '浏览过程分析报告', report_save: '另存为 PDF', report_page: '网页', report_pages: '网页',
    report_summary: '摘要', report_requests: '观察到个请求', report_duration: '用时', report_first_seen: '头一趟观察',
    report_last_seen: '末一趟观察', report_no_resources: '迭个网页呒没捕获到资源请求。',
    pro_title: '域名录制', pro_start: '开始录制', pro_stop: '停止录制', pro_recording: '勒浪录制',
    pro_stopped: '录制停了', pro_report_ready: '报告准备好了', pro_report_open: '打开报告',
    api_results_title: '最近个结果',
    api_results_note: '最近观察到个结果。Pro 勒浪录制个辰光，挑选个技术参数搭勿同个返回值会存勒本地报告里向。',
    consent_previews: '本地预览可以复制网页已经读取个 Canvas/WebGL 图像、精确个技术 API 值、WebRTC 证书指纹搭 Google X-Client-Data。图像搭网页标题可能包含个人或者敏感信息。图像、Google 标头搭证书预览只留勒有容量限制个内存里向，勿进入 Chrome 存储、Pro/PDF 或者导出。Pro 勒浪录制个辰光，挑选个技术 API 参数搭勿同个返回值会存勒本地报告里向。',
    permission_result_prompt: 'prompt 状态／还呒批准', permission_name_camera: '摄像头', permission_name_microphone: '话筒',
    badge_tooltip: '迭个标签页搭伊个框架里向观察到个技术数：$N$',
  },
};

for (const locale of ['yue', 'wuu']) {
  const table = {};
  for (const [key, entry] of Object.entries(reference)) {
    let message = entry.message;
    for (const [source, destination] of GLOSSARIES[locale]) message = message.replaceAll(source, destination);
    message = message.replaceAll('会会', '会');
    table[key] = { ...entry, message: OVERRIDES[locale][key] ?? message };
  }
  table.extName.message = EXTENSION_NAME;
  await mkdir(resolve(directory, 'ui-locales', locale), { recursive: true });
  await writeFile(resolve(directory, 'ui-locales', locale, 'messages.json'), JSON.stringify(table, null, 2) + '\n', 'utf8');
  console.log(`${locale}: ${Object.keys(table).length} local messages`);
}
