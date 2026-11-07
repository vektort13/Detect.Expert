// ADR-020 §I (S14): letter templates of data requests. Requests under a named article of a law — never a legal
// conclusion about the company. Every template is `unreviewed` until a lawyer of the jurisdiction checked it
// (docs/legal/request-templates.md); until then the first line of every letter is the DRAFT marker. Letter texts live
// here, not in _locales: the letter language is chosen per letter and does not follow the browser UI language.
// No URLs, no values: the user's identifier and name come only as arguments of renderRequestLetter.

import type {
  FieldKind,
  InterpretationConfidence,
  RequestJurisdiction,
  RequestKind,
  RequestLetterLang,
  SubmitTiming,
  ValueEncoding,
  ValueLocation,
} from '@detect-expert/contracts';

export const REQUEST_TEMPLATE_VERSION = '2026-10-17';

export type RequestLegalReviewStatus = 'unreviewed' | 'reviewed';

export interface RequestTemplate {
  templateId: string;
  version: string;
  jurisdiction: RequestJurisdiction;
  langs: readonly RequestLetterLang[];
  legalReviewStatus: RequestLegalReviewStatus;
}

export const REQUEST_TEMPLATES: Readonly<Record<RequestJurisdiction, RequestTemplate>> = {
  'gdpr-eu-eea': { templateId: 'gdpr-eu-eea', version: REQUEST_TEMPLATE_VERSION, jurisdiction: 'gdpr-eu-eea', langs: ['en', 'ru'], legalReviewStatus: 'unreviewed' },
  'gdpr-uk': { templateId: 'gdpr-uk', version: REQUEST_TEMPLATE_VERSION, jurisdiction: 'gdpr-uk', langs: ['en', 'ru'], legalReviewStatus: 'unreviewed' },
  'ccpa-ca': { templateId: 'ccpa-ca', version: REQUEST_TEMPLATE_VERSION, jurisdiction: 'ccpa-ca', langs: ['en'], legalReviewStatus: 'unreviewed' },
  'pdl-ru-152': { templateId: 'pdl-ru-152', version: REQUEST_TEMPLATE_VERSION, jurisdiction: 'pdl-ru-152', langs: ['ru'], legalReviewStatus: 'unreviewed' },
};

/** First line of a letter whose template has not been reviewed by a lawyer. */
export const REQUEST_DRAFT_MARKER: Readonly<Record<RequestLetterLang, string>> = {
  ru: '[ЧЕРНОВИК: текст шаблона не проверен юристом. Прочитайте его и удалите эту строку перед отправкой.]',
  en: '[DRAFT: this template has not been reviewed by a lawyer. Read it and delete this line before sending.]',
};

/** Body of a mailto: link when the full letter does not fit; the full text is copied by the same click. */
export const REQUEST_MAILTO_SHORT_BODY: Readonly<Record<RequestLetterLang, string>> = {
  ru: '[Вставьте сюда полный текст письма: расширение скопировало его в буфер обмена.]',
  en: '[Paste the full letter text here: the extension copied it to the clipboard.]',
};

/** Article references of the kinds in the subject line, per law. */
export const REQUEST_KIND_ARTICLES: Readonly<Record<RequestJurisdiction, Partial<Record<RequestKind, string>>>> = {
  'gdpr-eu-eea': { access: '15', erasure: '17', objection: '21' },
  'gdpr-uk': { access: '15', erasure: '17', objection: '21' },
  'ccpa-ca': { access: '§1798.110', erasure: '§1798.105', 'opt-out-sale-sharing': '§1798.120' },
  'pdl-ru-152': { access: '14', erasure: '21' },
};

/** Letter parts of one law in one language. Lines inside a part are joined by CRLF by the renderer. */
export interface RequestTemplateText {
  /** Subject line; `{articles}` = the chosen kinds' articles joined by ', '. */
  subject: string;
  /** `{entity}` = company name. */
  addressee: string;
  /** 152-FZ: sender, identity document and signature lines (blanks the user fills in); `{name}` when typed. */
  formalHeader: readonly string[] | null;
  formalHeaderNamed: readonly string[] | null;
  greeting: string | null;
  intro: string;
  kinds: Readonly<Partial<Record<RequestKind, string>>>;
  identitySender: string;
  /** `{identifier}`. */
  identityTyped: string;
  /** `{name}`; null when the name goes into the formal header. */
  identityName: string | null;
  factsIntro: string;
  factsOutro: string;
  /** CCPA only: the Global Privacy Control sentence (the user ticked it). */
  gpc: string | null;
  /** Deadline sentences per kind group: `all` always; `optOut` when the kinds include an opt-out. */
  deadline: string | null;
  deadlineOptOut: string | null;
  closing: string;
  /** `{name}` line after the closing when a name was typed; null = nothing. */
  closingName: string | null;
  /** 152-FZ: date and signature lines; `{date}` = today. */
  signature: readonly string[] | null;
}

const GDPR_EN_KINDS: RequestTemplateText['kinds'] = {
  access:
    'Access (Article 15). Please confirm whether you process personal data concerning me and, if you do, provide a copy of the data and the information listed in Article 15(1): the purposes of the processing, the categories of data, the recipients or categories of recipients, the storage period, and the source of the data where it was not collected from me.',
  erasure:
    'Erasure (Article 17). Please erase the personal data concerning me. Under Article 19, please also communicate the erasure to each recipient to whom the data have been disclosed, and tell me who those recipients are.',
  objection:
    'Objection (Article 21). I object to the processing of personal data concerning me for direct marketing, including profiling related to it (Article 21(2)), and to processing based on Article 6(1)(e) or (f) (Article 21(1)).',
};

const GDPR_RU_KINDS: RequestTemplateText['kinds'] = {
  access:
    'Доступ (статья 15). Прошу подтвердить, обрабатываете ли вы персональные данные, относящиеся ко мне, и если да — предоставить копию этих данных и сведения, перечисленные в статье 15(1): цели обработки, категории данных, получателей или категории получателей, срок хранения, а также источник данных, если они получены не от меня.',
  erasure:
    'Удаление (статья 17). Прошу удалить персональные данные, относящиеся ко мне. В соответствии со статьёй 19 прошу также сообщить об удалении каждому получателю, которому данные были раскрыты, и сообщить мне, кто эти получатели.',
  objection:
    'Возражение (статья 21). Возражаю против обработки персональных данных, относящихся ко мне, в целях прямого маркетинга, включая связанное с ним профилирование (статья 21(2)), а также против обработки на основании статьи 6(1)(e) или (f) (статья 21(1)).',
};

const EN_FACTS_INTRO = 'To help you find the data, here are observations recorded by a browser extension on my device:';
const EN_FACTS_OUTRO = 'These observations are technical records of what my browser sent; they are not a legal assessment.';
const RU_FACTS_INTRO = 'Чтобы вам было проще найти данные, привожу наблюдения, записанные расширением браузера на моём устройстве:';
const RU_FACTS_OUTRO = 'Эти наблюдения — технические записи о том, что отправлял мой браузер, а не правовая оценка.';

function gdprEn(intro: string, subject: string): RequestTemplateText {
  return {
    subject,
    addressee: 'To: {entity}',
    formalHeader: null,
    formalHeaderNamed: null,
    greeting: 'Dear Sir or Madam,',
    intro,
    kinds: GDPR_EN_KINDS,
    identitySender: 'Please identify me by the e-mail address this message is sent from.',
    identityTyped: 'Please identify me by this identifier: {identifier}',
    identityName: 'My name: {name}',
    factsIntro: EN_FACTS_INTRO,
    factsOutro: EN_FACTS_OUTRO,
    gpc: null,
    deadline: 'Under Article 12(3), please reply without undue delay and in any event within one month of receiving this request.',
    deadlineOptOut: null,
    closing: 'Kind regards,',
    closingName: null,
    signature: null,
  };
}

function gdprRu(intro: string, subject: string): RequestTemplateText {
  return {
    subject,
    addressee: 'Кому: {entity}',
    formalHeader: null,
    formalHeaderNamed: null,
    greeting: 'Здравствуйте!',
    intro,
    kinds: GDPR_RU_KINDS,
    identitySender: 'Прошу идентифицировать меня по адресу электронной почты, с которого отправлено это письмо.',
    identityTyped: 'Прошу идентифицировать меня по следующему идентификатору: {identifier}',
    identityName: 'Моё имя: {name}',
    factsIntro: RU_FACTS_INTRO,
    factsOutro: RU_FACTS_OUTRO,
    gpc: null,
    deadline: 'В соответствии со статьёй 12(3) прошу ответить без неоправданной задержки и в любом случае в течение одного месяца с момента получения запроса.',
    deadlineOptOut: null,
    closing: 'С уважением,',
    closingName: null,
    signature: null,
  };
}

export const REQUEST_TEMPLATE_TEXTS: Readonly<Record<RequestJurisdiction, Readonly<Partial<Record<RequestLetterLang, RequestTemplateText>>>>> = {
  'gdpr-eu-eea': {
    en: gdprEn('I am writing to make a request under the General Data Protection Regulation (EU) 2016/679 (GDPR) about personal data relating to me that you process.', 'Data subject request under the GDPR (Articles {articles})'),
    ru: gdprRu('Обращаюсь к вам с запросом в соответствии с Общим регламентом по защите данных (ЕС) 2016/679 (GDPR) в отношении обрабатываемых вами персональных данных, относящихся ко мне.', 'Запрос субъекта данных по GDPR (статьи {articles})'),
  },
  'gdpr-uk': {
    en: gdprEn('I am writing to make a request under the UK General Data Protection Regulation (UK GDPR) and the Data Protection Act 2018 about personal data relating to me that you process.', 'Data subject request under the UK GDPR (Articles {articles})'),
    ru: gdprRu('Обращаюсь к вам с запросом в соответствии с Общим регламентом по защите данных Великобритании (UK GDPR) и Законом о защите данных 2018 года в отношении обрабатываемых вами персональных данных, относящихся ко мне.', 'Запрос субъекта данных по UK GDPR (статьи {articles})'),
  },
  'ccpa-ca': {
    en: {
      subject: 'Consumer request under the California Consumer Privacy Act ({articles})',
      addressee: 'To: {entity}',
      formalHeader: null,
      formalHeaderNamed: null,
      greeting: 'Dear Sir or Madam,',
      intro: 'I am a California resident and I am writing to make a request under the California Consumer Privacy Act, as amended by the California Privacy Rights Act (CCPA), about personal information about me that you have collected.',
      kinds: {
        access:
          'Right to know (§1798.110). Please disclose the categories of personal information you have collected about me, the categories of sources, the business or commercial purpose for collecting, selling or sharing it, the categories of third parties to whom you disclose it, and the specific pieces of personal information you have collected about me.',
        erasure: 'Right to delete (§1798.105). Please delete the personal information about me that you have collected from me, and notify your service providers and contractors to delete it as well.',
        'opt-out-sale-sharing': 'Right to opt out of sale and sharing (§1798.120). Please do not sell or share personal information about me.',
      },
      identitySender: 'Please identify me by the e-mail address this message is sent from.',
      identityTyped: 'Please identify me by this identifier: {identifier}',
      identityName: 'My name: {name}',
      factsIntro: EN_FACTS_INTRO,
      factsOutro: EN_FACTS_OUTRO,
      gpc: 'My browser also sends the Global Privacy Control signal (Sec-GPC: 1). Please treat it as my request to opt out of the sale and sharing of personal information about me.',
      deadline: 'Under §1798.130(a)(2), please respond to the requests to know and to delete within 45 days of receiving this request.',
      deadlineOptOut: 'Please act on the request to opt out as soon as feasibly possible.',
      closing: 'Kind regards,',
      closingName: null,
      signature: null,
    },
  },
  'pdl-ru-152': {
    ru: {
      subject: 'Запрос субъекта персональных данных (152-ФЗ, статьи {articles})',
      addressee: 'Кому: {entity}',
      formalHeader: ['От: ______________________ (фамилия, имя, отчество)', 'Документ, удостоверяющий личность: ______________________ (вид, номер, дата выдачи, кем выдан)'],
      formalHeaderNamed: ['От: {name}', 'Документ, удостоверяющий личность: ______________________ (вид, номер, дата выдачи, кем выдан)'],
      greeting: null,
      intro: 'В соответствии с Федеральным законом от 27.07.2006 № 152-ФЗ «О персональных данных» направляю запрос в отношении моих персональных данных, которые обрабатывает ваша организация.',
      kinds: {
        access:
          'Доступ к сведениям (статья 14). Прошу подтвердить факт обработки моих персональных данных и сообщить: правовые основания и цели обработки; применяемые способы обработки; перечень обрабатываемых персональных данных и источник их получения; сроки обработки и хранения; сведения о лицах, которым персональные данные раскрыты или могут быть раскрыты, а также о лицах, которые обрабатывают их по вашему поручению.',
        erasure: 'Прекращение обработки и уничтожение (статья 21). Прошу прекратить обработку моих персональных данных и уничтожить их, а также уведомить меня о результатах.',
      },
      identitySender: 'Сведения, подтверждающие моё участие в отношениях с оператором: мои данные связаны с адресом электронной почты, с которого отправлено это письмо.',
      identityTyped: 'Сведения, подтверждающие моё участие в отношениях с оператором: идентификатор {identifier}',
      identityName: null,
      factsIntro: RU_FACTS_INTRO,
      factsOutro: RU_FACTS_OUTRO,
      gpc: null,
      deadline: 'Прошу направить ответ в срок, установленный статьёй 20 Федерального закона № 152-ФЗ.',
      deadlineOptOut: null,
      closing: 'С уважением,',
      closingName: null,
      signature: ['Дата: {date}', 'Подпись: ______________________'],
    },
  },
};

// ---------------------------------------------------------------------------
// Fact phrases (RequestEvidenceFact → one line of the letter). No verdict: what the browser sent, where and when.
// ---------------------------------------------------------------------------

export interface RequestFactWords {
  dataKind: Readonly<Record<FieldKind, string>>;
  encoding: Readonly<Record<ValueEncoding, string>>;
  location: Readonly<Partial<Record<ValueLocation, string>>>;
  timing: Readonly<Partial<Record<SubmitTiming, string>>>;
  confidence: Readonly<Record<InterpretationConfidence, string>>;
  /** `{day}`, `{site}`, `{receiver}`, `{data}`, `{details}`, `{script}`, `{confidence}`. */
  valueMatch: string;
  opaque: string;
  passwordListener: string;
  replay: string;
  sighting: string;
  noReceiver: string;
  /** `{name}` = parameter name. */
  parameter: string;
  /** `{address}`. */
  endpoint: string;
  /** `{address}`. */
  scriptExternal: string;
  scriptDocument: string;
  confidenceSentence: string;
}

const HASH_EN = (name: string, form: string): string => 'as a ' + name + ' hash' + form;
const HASH_RU = (name: string, form: string): string => 'в виде хэша ' + name + form;

export const REQUEST_FACT_WORDS: Readonly<Record<RequestLetterLang, RequestFactWords>> = {
  en: {
    dataKind: { email: 'e-mail address', phone: 'phone number', name: 'name' },
    encoding: {
      plain: 'as plain text',
      'plain-normalized': 'as plain text (normalized)',
      'url-encoded': 'URL-encoded',
      base64: 'Base64-encoded',
      'in-base64-container': 'inside a Base64 block',
      'md5-hex': HASH_EN('MD5', ''),
      'sha1-hex': HASH_EN('SHA-1', ''),
      'sha256-hex': HASH_EN('SHA-256', ''),
      'sha512-hex': HASH_EN('SHA-512', ''),
      'md5-base64': HASH_EN('MD5', ' (Base64)'),
      'sha1-base64': HASH_EN('SHA-1', ' (Base64)'),
      'sha256-base64': HASH_EN('SHA-256', ' (Base64)'),
      'sha512-base64': HASH_EN('SHA-512', ' (Base64)'),
    },
    location: { query: 'in the address query', path: 'in the address path', 'body-form': 'in the form body', 'body-json': 'in the JSON body', 'body-text': 'in the text body' },
    timing: { 'before-submit': 'before the form was submitted', 'after-submit': 'when the form was submitted' },
    confidence: { high: 'high', medium: 'medium', low: 'low', unassessed: 'not assessed' },
    valueMatch: '{day}: on the site {site}, a request was sent to {receiver} that contained the {data} I had entered in a form{details}{script}.',
    opaque: '{day}: on the site {site}, after I entered my {data} in a form, a request whose body could not be read was sent to {receiver}{details}{script}.',
    passwordListener: '{day}: on the site {site}, a page script registered an input handler on a password field{script} (the extension does not read passwords).',
    replay: '{day}: on the site {site}, the page repeatedly sent requests to {receiver}; the page behaved like a session recorder (the content of the requests was not checked).',
    sighting: '{day}: while I was on the site {site}, my browser sent requests to {receiver}.',
    noReceiver: 'a receiver without a domain name',
    parameter: 'parameter "{name}"',
    endpoint: 'address {address}',
    scriptExternal: '; sent by a script from {address} (sampled from the call stack; the page can alter this)',
    scriptDocument: '; sent by an inline script of the page (sampled from the call stack)',
    confidenceSentence: 'Confidence of the extension: {confidence}.',
  },
  ru: {
    dataKind: { email: 'адрес электронной почты', phone: 'номер телефона', name: 'имя' },
    encoding: {
      plain: 'в открытом виде',
      'plain-normalized': 'в открытом виде (нормализованном)',
      'url-encoded': 'в URL-кодировке',
      base64: 'в кодировке Base64',
      'in-base64-container': 'внутри блока Base64',
      'md5-hex': HASH_RU('MD5', ''),
      'sha1-hex': HASH_RU('SHA-1', ''),
      'sha256-hex': HASH_RU('SHA-256', ''),
      'sha512-hex': HASH_RU('SHA-512', ''),
      'md5-base64': HASH_RU('MD5', ' (Base64)'),
      'sha1-base64': HASH_RU('SHA-1', ' (Base64)'),
      'sha256-base64': HASH_RU('SHA-256', ' (Base64)'),
      'sha512-base64': HASH_RU('SHA-512', ' (Base64)'),
    },
    location: { query: 'в параметрах адреса', path: 'в пути адреса', 'body-form': 'в теле формы', 'body-json': 'в теле JSON', 'body-text': 'в текстовом теле' },
    timing: { 'before-submit': 'до отправки формы', 'after-submit': 'при отправке формы' },
    confidence: { high: 'высокая', medium: 'средняя', low: 'низкая', unassessed: 'не оценивалась' },
    valueMatch: '{day}: на сайте {site} получателю {receiver} был отправлен запрос с данными из поля «{data}», которые я ввёл(а) в форму{details}{script}.',
    opaque: '{day}: на сайте {site} после того, как я ввёл(а) {data} в форму, получателю {receiver} был отправлен запрос, тело которого прочитать не удалось{details}{script}.',
    passwordListener: '{day}: на сайте {site} скрипт страницы зарегистрировал обработчик ввода на поле пароля{script} (пароли расширение не читает).',
    replay: '{day}: на сайте {site} страница многократно отправляла запросы получателю {receiver}; поведение страницы похоже на запись сессии (содержимое запросов не проверялось).',
    sighting: '{day}: когда я был(а) на сайте {site}, мой браузер отправлял запросы получателю {receiver}.',
    noReceiver: 'без доменного имени',
    parameter: 'параметр «{name}»',
    endpoint: 'адрес {address}',
    scriptExternal: '; запрос отправил скрипт с адреса {address} (по выборке стека вызовов; страница может её исказить)',
    scriptDocument: '; запрос отправил встроенный скрипт страницы (по выборке стека вызовов)',
    confidenceSentence: 'Уверенность расширения: {confidence}.',
  },
};
