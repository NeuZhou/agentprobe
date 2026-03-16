/**
 * Multi-Language Support (i18n) - Internationalization for test descriptions and reports.
 *
 * Supports: en, zh-CN (minimum), extensible to ja, ko, de, fr.
 */

export type Locale = 'en' | 'zh-CN' | 'ja' | 'ko' | 'de' | 'fr';

export interface TranslationStrings {
  // Report headers
  testResults: string;
  passed: string;
  failed: string;
  skipped: string;
  duration: string;
  total: string;

  // Coverage
  coverageReport: string;
  toolCoverage: string;
  assertionCoverage: string;
  scenarioCoverage: string;
  overallScore: string;
  untested: string;
  unused: string;
  missing: string;

  // Profiler
  agentProfile: string;
  decisionStyle: string;
  toolPreference: string;
  errorHandling: string;
  costPattern: string;
  latencyPattern: string;

  // Mutation
  mutationReport: string;
  mutationScore: string;
  caught: string;
  escaped: string;

  // Status
  running: string;
  complete: string;
  error: string;

  // Decision styles
  deliberate: string;
  impulsive: string;
  balanced: string;

  // Cost patterns
  frontLoaded: string;
  backLoaded: string;
  even: string;

  // Scenario types
  happyPath: string;
  errorCase: string;
  edgeCase: string;
  security: string;
  performance: string;
}

const TRANSLATIONS: Record<Locale, TranslationStrings> = {
  'en': {
    testResults: 'Test Results',
    passed: 'Passed',
    failed: 'Failed',
    skipped: 'Skipped',
    duration: 'Duration',
    total: 'Total',
    coverageReport: 'Coverage Report',
    toolCoverage: 'Tool Coverage',
    assertionCoverage: 'Assertion Coverage',
    scenarioCoverage: 'Scenario Coverage',
    overallScore: 'Overall Score',
    untested: 'Untested',
    unused: 'Unused',
    missing: 'Missing',
    agentProfile: 'Agent Profile',
    decisionStyle: 'Decision style',
    toolPreference: 'Tool preference',
    errorHandling: 'Error handling',
    costPattern: 'Cost pattern',
    latencyPattern: 'Latency pattern',
    mutationReport: 'Mutation Report',
    mutationScore: 'Mutation score',
    caught: 'CAUGHT',
    escaped: 'ESCAPED',
    running: 'Running',
    complete: 'Complete',
    error: 'Error',
    deliberate: 'deliberate',
    impulsive: 'impulsive',
    balanced: 'balanced',
    frontLoaded: 'front-loaded',
    backLoaded: 'back-loaded',
    even: 'even',
    happyPath: 'Happy Path',
    errorCase: 'Error',
    edgeCase: 'Edge Case',
    security: 'Security',
    performance: 'Performance',
  },
  'zh-CN': {
    testResults: '测试结果',
    passed: '通过',
    failed: '失败',
    skipped: '跳过',
    duration: '耗时',
    total: '总计',
    coverageReport: '覆盖率报告',
    toolCoverage: '工具覆盖率',
    assertionCoverage: '断言覆盖率',
    scenarioCoverage: '场景覆盖率',
    overallScore: '综合评分',
    untested: '未测试',
    unused: '未使用',
    missing: '缺失',
    agentProfile: 'Agent 行为画像',
    decisionStyle: '决策风格',
    toolPreference: '工具偏好',
    errorHandling: '错误处理',
    costPattern: '成本分布',
    latencyPattern: '延迟模式',
    mutationReport: '变异测试报告',
    mutationScore: '变异捕获率',
    caught: '已捕获',
    escaped: '已逃逸',
    running: '运行中',
    complete: '完成',
    error: '错误',
    deliberate: '深思熟虑型',
    impulsive: '快速行动型',
    balanced: '均衡型',
    frontLoaded: '前置消耗型',
    backLoaded: '后置消耗型',
    even: '均匀分布型',
    happyPath: '正常路径',
    errorCase: '异常场景',
    edgeCase: '边界场景',
    security: '安全场景',
    performance: '性能场景',
  },
  'ja': {
    testResults: 'テスト結果',
    passed: '成功',
    failed: '失敗',
    skipped: 'スキップ',
    duration: '所要時間',
    total: '合計',
    coverageReport: 'カバレッジレポート',
    toolCoverage: 'ツールカバレッジ',
    assertionCoverage: 'アサーションカバレッジ',
    scenarioCoverage: 'シナリオカバレッジ',
    overallScore: '総合スコア',
    untested: '未テスト',
    unused: '未使用',
    missing: '欠落',
    agentProfile: 'エージェントプロファイル',
    decisionStyle: '意思決定スタイル',
    toolPreference: 'ツール選好',
    errorHandling: 'エラー処理',
    costPattern: 'コストパターン',
    latencyPattern: 'レイテンシパターン',
    mutationReport: 'ミューテーションレポート',
    mutationScore: 'ミューテーションスコア',
    caught: '検出',
    escaped: '未検出',
    running: '実行中',
    complete: '完了',
    error: 'エラー',
    deliberate: '慎重型',
    impulsive: '即断型',
    balanced: 'バランス型',
    frontLoaded: '前半集中型',
    backLoaded: '後半集中型',
    even: '均等型',
    happyPath: '正常パス',
    errorCase: 'エラーケース',
    edgeCase: 'エッジケース',
    security: 'セキュリティ',
    performance: 'パフォーマンス',
  },
  'ko': {
    testResults: '테스트 결과',
    passed: '통과',
    failed: '실패',
    skipped: '건너뜀',
    duration: '소요시간',
    total: '총계',
    coverageReport: '커버리지 보고서',
    toolCoverage: '도구 커버리지',
    assertionCoverage: '어설션 커버리지',
    scenarioCoverage: '시나리오 커버리지',
    overallScore: '종합 점수',
    untested: '미테스트',
    unused: '미사용',
    missing: '누락',
    agentProfile: '에이전트 프로파일',
    decisionStyle: '의사결정 스타일',
    toolPreference: '도구 선호도',
    errorHandling: '오류 처리',
    costPattern: '비용 패턴',
    latencyPattern: '지연 패턴',
    mutationReport: '뮤테이션 보고서',
    mutationScore: '뮤테이션 점수',
    caught: '검출',
    escaped: '미검출',
    running: '실행 중',
    complete: '완료',
    error: '오류',
    deliberate: '신중형',
    impulsive: '즉결형',
    balanced: '균형형',
    frontLoaded: '전반 집중형',
    backLoaded: '후반 집중형',
    even: '균등형',
    happyPath: '정상 경로',
    errorCase: '오류 케이스',
    edgeCase: '경계 케이스',
    security: '보안',
    performance: '성능',
  },
  'de': {
    testResults: 'Testergebnisse',
    passed: 'Bestanden',
    failed: 'Fehlgeschlagen',
    skipped: 'Übersprungen',
    duration: 'Dauer',
    total: 'Gesamt',
    coverageReport: 'Abdeckungsbericht',
    toolCoverage: 'Werkzeugabdeckung',
    assertionCoverage: 'Assertion-Abdeckung',
    scenarioCoverage: 'Szenarioabdeckung',
    overallScore: 'Gesamtbewertung',
    untested: 'Ungetestet',
    unused: 'Unbenutzt',
    missing: 'Fehlend',
    agentProfile: 'Agent-Profil',
    decisionStyle: 'Entscheidungsstil',
    toolPreference: 'Werkzeugpräferenz',
    errorHandling: 'Fehlerbehandlung',
    costPattern: 'Kostenmuster',
    latencyPattern: 'Latenzmuster',
    mutationReport: 'Mutationsbericht',
    mutationScore: 'Mutationswert',
    caught: 'ERKANNT',
    escaped: 'ENTKOMMEN',
    running: 'Läuft',
    complete: 'Fertig',
    error: 'Fehler',
    deliberate: 'bedacht',
    impulsive: 'impulsiv',
    balanced: 'ausgewogen',
    frontLoaded: 'frontlastig',
    backLoaded: 'endlastig',
    even: 'gleichmäßig',
    happyPath: 'Normalfall',
    errorCase: 'Fehlerfall',
    edgeCase: 'Grenzfall',
    security: 'Sicherheit',
    performance: 'Leistung',
  },
  'fr': {
    testResults: 'Résultats des tests',
    passed: 'Réussi',
    failed: 'Échoué',
    skipped: 'Ignoré',
    duration: 'Durée',
    total: 'Total',
    coverageReport: 'Rapport de couverture',
    toolCoverage: 'Couverture des outils',
    assertionCoverage: 'Couverture des assertions',
    scenarioCoverage: 'Couverture des scénarios',
    overallScore: 'Score global',
    untested: 'Non testé',
    unused: 'Non utilisé',
    missing: 'Manquant',
    agentProfile: 'Profil de l\'agent',
    decisionStyle: 'Style de décision',
    toolPreference: 'Préférence d\'outils',
    errorHandling: 'Gestion des erreurs',
    costPattern: 'Modèle de coûts',
    latencyPattern: 'Modèle de latence',
    mutationReport: 'Rapport de mutation',
    mutationScore: 'Score de mutation',
    caught: 'DÉTECTÉ',
    escaped: 'ÉCHAPPÉ',
    running: 'En cours',
    complete: 'Terminé',
    error: 'Erreur',
    deliberate: 'délibéré',
    impulsive: 'impulsif',
    balanced: 'équilibré',
    frontLoaded: 'chargé en début',
    backLoaded: 'chargé en fin',
    even: 'uniforme',
    happyPath: 'Cas nominal',
    errorCase: 'Cas d\'erreur',
    edgeCase: 'Cas limite',
    security: 'Sécurité',
    performance: 'Performance',
  },
};

let currentLocale: Locale = 'en';

/**
 * Set the active locale.
 */
export function setLocale(locale: Locale): void {
  if (!TRANSLATIONS[locale]) {
    throw new Error(`Unsupported locale: ${locale}. Supported: ${getSupportedLocales().join(', ')}`);
  }
  currentLocale = locale;
}

/**
 * Get the active locale.
 */
export function getLocale(): Locale {
  return currentLocale;
}

/**
 * Get supported locales.
 */
export function getSupportedLocales(): Locale[] {
  return Object.keys(TRANSLATIONS) as Locale[];
}

/**
 * Get translation string for current locale.
 */
export function t(key: keyof TranslationStrings): string {
  return TRANSLATIONS[currentLocale]?.[key] ?? TRANSLATIONS['en'][key] ?? key;
}

/**
 * Get all translations for a specific locale.
 */
export function getTranslations(locale?: Locale): TranslationStrings {
  return TRANSLATIONS[locale ?? currentLocale] ?? TRANSLATIONS['en'];
}

/**
 * Detect locale from environment or config.
 */
export function detectLocale(): Locale {
  const envLang = process.env.AGENTPROBE_LOCALE || process.env.LANG || process.env.LC_ALL || '';
  if (envLang.startsWith('zh')) return 'zh-CN';
  if (envLang.startsWith('ja')) return 'ja';
  if (envLang.startsWith('ko')) return 'ko';
  if (envLang.startsWith('de')) return 'de';
  if (envLang.startsWith('fr')) return 'fr';
  return 'en';
}
