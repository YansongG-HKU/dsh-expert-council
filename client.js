/**
 * dsh-expert-council — Client (browser) half.
 *
 * Hand-written browser plugin artifact: no build tooling, no npm imports, no JSX.
 * It only registers a lazy factory; nothing runs until the module is materialized.
 * Inside the factory it depends on the browser module table for React and
 * contributes two slots through the Host's `slots` service:
 *
 *   - `sidebar.panellist` (id `dsh-expert-council`, order 31): the rail glyph.
 *   - `main` (key `dsh-expert-council`): the council panel, selected by the
 *     sidebar entry through the same id.
 *
 * Panel data comes from the co-located Host routes under `/expert-council/api/*`
 * (lib/panel.js). Every request carries the `x-expert-council: 1` header, which
 * marks it as coming from this plugin's own page code.
 */
window.__ModuleLoader__.load({
  id: 'dsh-expert-council',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace owned by this Client half. */
    const NS = 'dshExpertCouncil'
    /** Sidebar entry id; it also addresses the `main` panel key. */
    const PANEL_ID = 'dsh-expert-council'
    /** Host routes registered by lib/panel.js. */
    const API_STATE = '/expert-council/api/state'
    const API_CONSULT = '/expert-council/api/consult'
    const API_REPORT = '/expert-council/api/report'
    const API_ACTION = '/expert-council/api/action'
    /** Request header that gates the Host routes. */
    const HEADER_NAME = 'x-expert-council'
    /** Auto-refresh cadence for the panel while it is mounted and visible. */
    const REFRESH_MS = 3000
    /** Poll cadence for one consult while a real run is in progress. */
    const RUN_POLL_MS = 1500
    /** Cool accent for the council identity; amber is reserved by its sibling forge panel. */
    const ACCENT = '#6d8df0'
    /** Convene constraints mirrored from the Host protocol. */
    const QUESTION_MIN = 8
    const BUDGET_MIN = 200
    const BUDGET_MAX = 20000

    /**
     * Client locale dictionaries. Chinese is the primary language; every visible
     * string in this file comes from here. Placeholders use `{name}`.
     */
    const DICTIONARIES = {
      zh: {
        lang: 'zh',
        panel: '专家团',
        title: '专家团',
        subtitle: '固定专家镜头 + 证据协议，把一次决策做成可复核的会诊记录',
        refresh: '刷新',
        refreshing: '刷新中…',
        autoRefresh: '每 3 秒自动刷新',
        updated: '更新于 {time}',
        statTeams: '模板',
        statExperts: '专家',
        statConsults: '会诊',
        statTokens: '累计 token',
        tokenUnit: 'token',
        loading: '正在读取…',
        errorLoad: '读取失败：{message}',
        retry: '重试',
        unknown: '—',
        teamsTitle: '专家团模板',
        viewTeam: '查看',
        convene: '召开会诊',
        defaultMode: '默认档位',
        membersLabel: '成员',
        estimatesLabel: '预算估算',
        agendaLabel: '议程',
        artifactsLabel: '产出物',
        protocol: '合作规范',
        protocolCount: '{count} 条',
        expertLenses: '专家镜头',
        lensLabel: '镜头',
        mandateLabel: '职责',
        asksLabel: '必问',
        redLinesLabel: '红线',
        missesLabel: '易漏',
        budgetLabel: '预算',
        roleLead: '主持',
        recentConsults: '最近会诊',
        recentEmpty: '还没有会诊；从上面选一个团队开始。',
        roundsCount: '{count} 轮',
        decisionLabel: '裁决',
        noDecision: '未裁决',
        statusOpen: '进行中',
        statusVerdict: '已裁决',
        statusArchived: '已归档',
        modeLean: '轻会诊',
        modeStandard: '标准会诊',
        modeDeep: '深会诊',
        modeLeanWhen: '例行检查、低风险，先用一组镜头快速过一遍',
        modeStandardWhen: '重要决策，需要可追溯的意见与异议',
        modeDeepWhen: '高风险、不可逆，需要独立并行的专家意见',
        estimateHint: '预计约 {cap} token',
        conveneTitle: '召开会诊',
        questionLabel: '问题（必填）',
        questionPlaceholder: '把要决定的事写成一句话，例如：要不要把会话存储换成 SQLite？',
        questionMeta: '{count} 字 · 至少 {min} 字',
        questionTooShort: '问题太短：至少 {min} 字',
        contextLabel: '背景（可选）',
        contextPlaceholder: '已知约束、证据或之前的讨论…',
        modeFieldLabel: '会诊档位',
        budgetCapLabel: '预算上限（可选）',
        budgetCapPlaceholder: '默认 {cap}',
        budgetCapHint: '200–20000 token；留空使用该档位默认值',
        budgetCapInvalid: '预算上限必须是 200–20000 之间的数字',
        submitConvene: '开始会诊',
        convening: '立案中…',
        conveneSuccess: '已立案：{id}',
        conveneFailed: '召开失败：{message}',
        briefConsultId: '会诊 ID',
        sessionDraftHint: '简报已放进输入框草稿，尚未发送；确认后发送即可开始。',
        sessionStarted: '已打开会诊会话',
        sessionOpened: '已打开会话 {id}',
        sessionLaunchFailed: '会话启动失败：{message}',
        backToList: '返回列表',
        closeDetail: '关闭详情',
        escHint: 'Esc 关闭',
        detailLoading: '正在读取会诊…',
        detailError: '读取会诊失败：{message}',
        consultNotFound: '会诊不存在或已被删除',
        consultMissingHint: '它可能已被删除，或 id 不正确。',
        sectionQuestion: '问题与背景',
        sectionVerdict: '裁决',
        sectionDisagreements: '分歧',
        sectionRounds: '意见轮次',
        budgetLine: '已用 {tokens} / 预算 {cap} token',
        createdAt: '创建于 {time}',
        contextEmpty: '无背景',
        verdictDecision: '结论',
        verdictConfidence: '置信度',
        verdictRationale: '理由',
        verdictDissent: '异议',
        verdictUnresolved: '未决问题',
        verdictReversal: '推翻条件',
        verdictActions: '行动项',
        noVerdict: '这次会诊还没有裁决',
        dissentEmpty: '没有登记异议',
        disagreementsEmpty: '没有检测到分歧',
        kindStance: '立场冲突',
        kindConfidence: '置信度差距',
        pairComparison: '{left} vs {right}',
        roundsEmpty: '还没有意见轮次',
        roundLabel: '第 {round} 轮',
        roundTokens: '{tokens} token',
        opinionsCount: '{count} 条意见',
        claimsLabel: '主张',
        claimEvidence: '证据',
        changesLabel: '什么会改变结论',
        unknownsLabel: '未知',
        unknownExpert: '未知专家',
        stanceSupport: '支持',
        stanceOppose: '反对',
        stanceConditional: '有条件',
        archive: '归档',
        archiving: '归档中…',
        archiveDone: '已归档',
        archiveFailed: '归档失败：{message}',
        confidenceValue: '{value}%',
        teamIntent: '适用场景',
        nlTitle: '用一句话调整',
        nlDesc: '不用懂字段：用一句话说要加什么专家、改哪个团队，助手会把它落到目录里。',
        nlPlaceholder: '例如：加一个只看数据授权的合规专家，并放进安全评审团',
        nlExamples: '示例',
        nlExample1: '加一个只看数据授权的合规专家',
        nlExample2: '建一个上线前检查团：SRE 主持，产品和安全参加',
        nlExample3: '把架构评审团默认改成轻会诊',
        nlSubmit: '交给专家团助手',
        nlSubmitting: '交办中…',
        nlSuccess: '已交给助手，改完面板会自动刷新（3 秒轮询）',
        nlEmpty: '先写一句要调整什么',
        nlHint: 'Enter 提交 · Ctrl / ⌘ + Enter 也行 · Shift + Enter 换行',
        nlSessionNote: '请按本简报用 expert_council 工具把调整落到目录里（save_expert / save_team / delete 都要带 request_quote）',
        historyTitle: '最近调整',
        historyDesc: '目录的每次改动都会留档，可核对是谁改的。',
        historyRequest: '原话：{text}',
        actorUser: '你',
        actorAgent: '助手',
        actionExpertCreate: '新增专家',
        actionExpertOverride: '覆盖专家',
        actionExpertDelete: '删除专家',
        actionExpertHide: '隐藏专家',
        actionTeamCreate: '新增团队',
        actionTeamOverride: '覆盖团队',
        actionTeamDelete: '删除团队',
        actionTeamHide: '隐藏团队',
        actionReset: '恢复出厂',
        overviewTitle: '概览',
        overviewDesc: '目录规模与会诊用量；上面的提示条说明调用边界。',
        teamsDesc: '固定镜头组合；先从模板开会，再按需自建或覆盖。',
        consultsDesc: '会诊与裁决都留档；点开可核对异议与推翻条件。',
        selectedLabel: '已选',
        lensBaseline: '镜头基线，可越过，不限制任务',
        intentLabel: '会诊类型',
        intentReview: '评审会诊',
        intentTask: '任务会诊',
        intentReviewWhen: '要一个判断、裁决或风险意见',
        intentTaskWhen: '要一个能直接用的产出：方案、代码、文案、设计、攻击面、计划、故事…',
        intentReviewDesc: '专家各自成稿 → 只对分歧交叉质询 → 主持给出可追溯的裁决。',
        intentTaskDesc: '专家各自交付产出 → 主持合并成一份完整成果；不设任务边界、不因主题或领域受限。',
        taskBudgetHint: '任务会诊预算由 Host 自动 ×1.5',
        taskResultTitle: '任务成果',
        taskNoResult: '还没有任务成果；先点「真实会诊」执行任务。',
        taskSummary: '摘要',
        taskNextActions: '下一步',
        taskDeliverables: '交付物清单',
        taskDeliverablesEmpty: '没有登记交付物',
        taskNoReview: '任务会诊只交付成果，不套用评审区块；完整成果见报告。',
        taskReportTitle: '完整成果报告',
        taskReportView: '查看完整成果',
        taskReportNote: '完整成果正文在报告 Markdown 里；点「查看完整成果」或下载。',
        taskMarker: '任务成果',
        taskPendingShort: '未产出',
        stageWork: '独立交付',
        stageMerge: '合并成果',
        runtimeWarning: '未选择默认模型，真实会诊不可用',
        domainsTitle: '专业领域',
        domainsDesc: '选一个领域：每个领域有 5 位专家镜头、证据等级与交付物，写清要决定的事即可立案。',
        domainLabel: '领域',
        domainEmpty: '领域包不可用',
        evidenceTitle: '证据等级',
        evidenceRequired: '必备证据',
        redFlags: '红旗',
        domainLaunchTitle: '发起会诊',
        launchConvene: '立案',
        launchRun: '真实会诊',
        launchRunUnavailable: '未选择默认模型，真实会诊不可用',
        launchHint: '立案只创建会诊与简报；真实会诊会立即执行：评审出裁决，任务出完整成果。',
        launchError: '发起失败：{message}',
        runTitle: '真实会诊',
        runIdleHint: '还没有真实会诊；点「真实会诊」让模型并行给出意见。',
        taskRunIdleHint: '还没有真实会诊；点「真实会诊」让专家交付并合并成果。',
        stageTitle: '阶段',
        stageIndependent: '独立成稿',
        stageCross: '交叉质询',
        stagePeer: '同行评议（深会诊）',
        stageVerdict: '主持裁决',
        stageSkipped: '跳过',
        stageActive: '进行中',
        stageDone: '已完成',
        stagePending: '待开始',
        runStatusRunning: '运行中',
        runStatusFinished: '已完成',
        runStatusFailed: '失败',
        runStatusCanceled: '已取消',
        runProvider: '模型',
        runTokensLabel: '用量',
        runDurationLabel: '耗时',
        unitMs: '毫秒',
        unitSeconds: '秒',
        runBudgetLabel: '预算',
        runErrorLabel: '失败原因',
        runExpertsTitle: '专家状态',
        runExpertEmpty: '还没有专家结果',
        runExpertsSummary: '{count} 次专家调用（逐条明细见报告）',
        runExpertOk: '成功',
        runExpertDegraded: '降级',
        runExpertFailed: '失败',
        runExpertRunning: '进行中',
        runFailedExperts: '失败专家 {count} 位',
        runQuorum: '法定人数 {success}/{required}',
        runQuorumMissing: '独立意见不足法定人数，结论可信度下降',
        cancelRun: '取消',
        canceling: '取消中…',
        cancelRunDone: '已取消',
        cancelRunFailed: '取消失败：{message}',
        reportTitle: '完整报告',
        reportView: '查看完整报告',
        reportDownload: '下载 Markdown',
        reportLoading: '正在读取报告…',
        reportFailed: '读取报告失败：{message}',
        reportClose: '关闭',
        reportMarker: '报告',
        artifactDelivered: '已产出',
        artifactNotes: '交付说明',
        emptyGuideTitle: '还没有会诊',
        emptyGuideHint: '选一个团队/领域 → 写清要评审还是直接产出 → 真实会诊',
        emptyGuideStep1: '选一个团队/领域',
        emptyGuideStep2: '写清要评审还是直接产出',
        emptyGuideStep3: '点「真实会诊」让专家团开始',
        expertDomainLabel: '所属领域（可选）',
        expertDomainNone: '不指定',
        consentNotice: '仅在你明确发起时使用：模型不会主动召开会诊，与 DSH 智能体团队（Agent Teams）无关。',
        consentNoticeOff: '显式调用门禁已关闭：模型也可以主动召开会诊；与 DSH 智能体团队（Agent Teams）仍互相独立。',
        newTeam: '新建团队',
        resetCustom: '重置自定义',
        resetConfirm: '重置会清空所有自定义专家与团队，并恢复内置模板。确定继续？',
        confirmReset: '确认重置',
        cancel: '取消',
        save: '保存',
        saving: '保存中…',
        working: '处理中…',
        saveFailed: '保存失败：{message}',
        deleteFailed: '删除失败：{message}',
        resetFailed: '重置失败：{message}',
        resetDone: '已重置自定义，内置模板已恢复',
        deletedDone: '已删除：{id}',
        hiddenDone: '已隐藏内置：{id}（可用「重置自定义」恢复）',
        teamSaved: '团队已保存',
        expertSaved: '专家已保存',
        editTeam: '编辑团队',
        editExpert: '编辑专家',
        newExpert: '新建专家',
        remove: '删除',
        badgeCustom: '自定义',
        badgeOverridden: '覆盖内置',
        badgePreset: '内置',
        incompleteTeam: '团队不完整',
        incompleteTeamHint: '成员已被删除；编辑团队补齐成员后才能召开会诊。',
        confirmDelete: '确认删除',
        deletePresetTeam: '隐藏这个内置模板？它会从列表消失，可通过「重置自定义」恢复。',
        deleteCustomTeam: '删除这个自定义团队？此操作不可撤销。',
        deletePresetExpert: '隐藏这个内置专家？依赖它的团队会缺人，可通过「重置自定义」恢复。',
        deleteCustomExpert: '删除这个自定义专家？此操作不可撤销。',
        groupLabel: '分组',
        idLabel: 'ID',
        nameZh: '中文名',
        nameEn: '英文名',
        taglineLabel: '一句话说明',
        linesHint: '每行一条',
        pairsLabel: '互补专家（pairs）',
        pairsHint: '每行一个专家 id',
        budgetLeanLabel: '轻会诊预算',
        budgetStandardLabel: '标准预算',
        budgetDeepLabel: '深会诊预算',
        membersHint: '勾选成员，并用单选框指定恰好一名主持',
        errIdInvalid: 'id 需以小写字母开头，可含数字与 -，2–41 个字符',
        errNameZh: '中文名至少 2 个字',
        errMandate: '职责至少 8 个字',
        errLens: '镜头不能为空',
        errAsks: '至少一条必问',
        errRedLines: '至少一条红线',
        errMisses: '易漏不能为空',
        errMembers: '至少选择 1 名成员',
        errLead: '必须恰好有一名主持',
        errBudgetOrder: '预算需递增：轻 ≤ 标准 ≤ 深，且都是正数',
        errAgenda: '至少一条议程',
        saveTeam: '保存团队',
        saveExpert: '保存专家',
        errorNetwork: '网络请求失败',
        errorHttp: 'HTTP {status}',
        errorUnexpected: '响应格式异常',
        errorUnknown: '未知错误',
      },
      en: {
        lang: 'en',
        panel: 'Expert Council',
        title: 'Expert Council',
        subtitle: 'Fixed expert lenses plus an evidence protocol turn one decision into a reviewable consult record',
        refresh: 'Refresh',
        refreshing: 'Refreshing…',
        autoRefresh: 'Auto-refreshes every 3 s',
        updated: 'Updated {time}',
        statTeams: 'Teams',
        statExperts: 'Experts',
        statConsults: 'Consults',
        statTokens: 'Total tokens',
        tokenUnit: 'tokens',
        loading: 'Loading…',
        errorLoad: 'Failed to load: {message}',
        retry: 'Retry',
        unknown: '—',
        teamsTitle: 'Team templates',
        viewTeam: 'View',
        convene: 'Convene',
        defaultMode: 'Default mode',
        membersLabel: 'Members',
        estimatesLabel: 'Budget estimates',
        agendaLabel: 'Agenda',
        artifactsLabel: 'Artifacts',
        protocol: 'Collaboration protocol',
        protocolCount: '{count} rules',
        expertLenses: 'Expert lenses',
        lensLabel: 'Lens',
        mandateLabel: 'Mandate',
        asksLabel: 'Must ask',
        redLinesLabel: 'Red lines',
        missesLabel: 'Blind spots',
        budgetLabel: 'Budget',
        roleLead: 'Chair',
        recentConsults: 'Recent consults',
        recentEmpty: 'No consults yet — pick a team above to start one.',
        roundsCount: '{count} rounds',
        decisionLabel: 'Verdict',
        noDecision: 'No verdict',
        statusOpen: 'Open',
        statusVerdict: 'Verdict',
        statusArchived: 'Archived',
        modeLean: 'Lean',
        modeStandard: 'Standard',
        modeDeep: 'Deep',
        modeLeanWhen: 'Routine, low-risk work; one quick pass through the lenses',
        modeStandardWhen: 'Important decisions that need traceable opinions and dissent',
        modeDeepWhen: 'High-risk, irreversible decisions that need independent parallel opinions',
        estimateHint: 'Estimated ~{cap} tokens',
        conveneTitle: 'Convene a consult',
        questionLabel: 'Question (required)',
        questionPlaceholder: 'Write the decision in one sentence, e.g. should we move session storage to SQLite?',
        questionMeta: '{count} chars · at least {min}',
        questionTooShort: 'Question too short: at least {min} characters',
        contextLabel: 'Context (optional)',
        contextPlaceholder: 'Known constraints, evidence, or prior discussion…',
        modeFieldLabel: 'Mode',
        budgetCapLabel: 'Budget cap (optional)',
        budgetCapPlaceholder: 'default {cap}',
        budgetCapHint: '200–20000 tokens; leave blank for this mode default',
        budgetCapInvalid: 'The budget cap must be a number between 200 and 20000',
        submitConvene: 'Start consult',
        convening: 'Filing…',
        conveneSuccess: 'Filed: {id}',
        conveneFailed: 'Convene failed: {message}',
        briefConsultId: 'Consult ID',
        sessionDraftHint: 'The brief is in the composer as an unsent draft; review it, then send to start.',
        sessionStarted: 'Consult session opened',
        sessionOpened: 'Opened session {id}',
        sessionLaunchFailed: 'Session launch failed: {message}',
        backToList: 'Back to list',
        closeDetail: 'Close detail',
        escHint: 'Esc to close',
        detailLoading: 'Loading consult…',
        detailError: 'Failed to load the consult: {message}',
        consultNotFound: 'This consult no longer exists',
        consultMissingHint: 'It may have been deleted, or the id is wrong.',
        sectionQuestion: 'Question & context',
        sectionVerdict: 'Verdict',
        sectionDisagreements: 'Disagreements',
        sectionRounds: 'Opinion rounds',
        budgetLine: 'Used {tokens} / budget {cap} tokens',
        createdAt: 'Created {time}',
        contextEmpty: 'No context',
        verdictDecision: 'Decision',
        verdictConfidence: 'Confidence',
        verdictRationale: 'Rationale',
        verdictDissent: 'Dissent',
        verdictUnresolved: 'Unresolved',
        verdictReversal: 'Reversal triggers',
        verdictActions: 'Actions',
        noVerdict: 'This consult has no verdict yet',
        dissentEmpty: 'No dissent recorded',
        disagreementsEmpty: 'No disagreements detected',
        kindStance: 'Stance conflict',
        kindConfidence: 'Confidence gap',
        pairComparison: '{left} vs {right}',
        roundsEmpty: 'No opinion rounds yet',
        roundLabel: 'Round {round}',
        roundTokens: '{tokens} tokens',
        opinionsCount: '{count} opinions',
        claimsLabel: 'Claims',
        claimEvidence: 'Evidence',
        changesLabel: 'What would change it',
        unknownsLabel: 'Unknowns',
        unknownExpert: 'Unknown expert',
        stanceSupport: 'Support',
        stanceOppose: 'Oppose',
        stanceConditional: 'Conditional',
        archive: 'Archive',
        archiving: 'Archiving…',
        archiveDone: 'Archived',
        archiveFailed: 'Archive failed: {message}',
        confidenceValue: '{value}%',
        teamIntent: 'Use when',
        nlTitle: 'Adjust in one sentence',
        nlDesc: "You don't need to know the fields: say what expert to add or which team to change, and the assistant writes it into the catalog.",
        nlPlaceholder: 'e.g. add a compliance expert focused on data authorization, and put it in the Security Review team',
        nlExamples: 'Examples',
        nlExample1: 'Add a compliance expert focused on data authorization',
        nlExample2: 'Create a pre-launch check team: SRE chairs, product and security join',
        nlExample3: 'Change the Architecture Review default mode to Lean',
        nlSubmit: 'Hand to the council assistant',
        nlSubmitting: 'Handing over…',
        nlSuccess: 'Handed to the assistant; the panel refreshes automatically once the change lands (3-second polling)',
        nlEmpty: 'Describe the change first',
        nlHint: 'Enter to submit · Ctrl / ⌘ + Enter also works · Shift + Enter for a newline',
        nlSessionNote: 'Follow this brief and apply the change with the expert_council tool (save_expert / save_team / delete must carry request_quote).',
        historyTitle: 'Recent changes',
        historyDesc: 'Every catalog change is recorded here so you can check who changed it.',
        historyRequest: 'Asked: {text}',
        actorUser: 'You',
        actorAgent: 'Assistant',
        actionExpertCreate: 'New expert',
        actionExpertOverride: 'Override expert',
        actionExpertDelete: 'Delete expert',
        actionExpertHide: 'Hide expert',
        actionTeamCreate: 'New team',
        actionTeamOverride: 'Override team',
        actionTeamDelete: 'Delete team',
        actionTeamHide: 'Hide team',
        actionReset: 'Factory reset',
        overviewTitle: 'Overview',
        overviewDesc: 'Catalog size and consult usage; the notice above states the invocation boundary.',
        teamsDesc: 'Fixed lens combinations; start from a template, then create or override your own.',
        consultsDesc: 'Consults and verdicts stay on record; open one to review dissent and reversal triggers.',
        selectedLabel: 'Selected',
        lensBaseline: 'Lens baseline only — cross it freely; it never limits the task',
        intentLabel: 'Consult type',
        intentReview: 'Review',
        intentTask: 'Task',
        intentReviewWhen: 'You want a judgment, verdict or risk opinion',
        intentTaskWhen: 'You want a usable artifact: plan, code, copy, design, attack surface, schedule, story…',
        intentReviewDesc: 'Experts write independently → cross-examine only disagreements → the chair gives a traceable verdict.',
        intentTaskDesc: 'Experts each deliver an artifact → the chair merges them into one complete result; no task boundaries and no topic/domain limits.',
        taskBudgetHint: 'Task consults automatically get a 1.5× budget from the Host',
        taskResultTitle: 'Task result',
        taskNoResult: 'No task result yet; click Run for real to execute the task.',
        taskSummary: 'Summary',
        taskNextActions: 'Next steps',
        taskDeliverables: 'Deliverables',
        taskDeliverablesEmpty: 'No deliverables recorded',
        taskNoReview: 'Task consults deliver a result instead of review blocks; open the report for the full result.',
        taskReportTitle: 'Full result report',
        taskReportView: 'View full result',
        taskReportNote: 'The full result lives in the report Markdown; view or download it here.',
        taskMarker: 'Task result',
        taskPendingShort: 'No result yet',
        stageWork: 'Independent delivery',
        stageMerge: 'Merge result',
        runtimeWarning: 'No default model is selected, so real consults are unavailable',
        domainsTitle: 'Professional domains',
        domainsDesc: 'Pick a field: each ships five expert lenses, an evidence ladder and deliverables. State the decision to file a consult.',
        domainLabel: 'Domain',
        domainEmpty: 'No domain packs available',
        evidenceTitle: 'Evidence ladder',
        evidenceRequired: 'Required evidence',
        redFlags: 'Red flags',
        domainLaunchTitle: 'Launch a consult',
        launchConvene: 'File consult',
        launchRun: 'Run for real',
        launchRunUnavailable: 'Real consults need a default model (unavailable)',
        launchHint: 'Filing only creates the consult and brief; a real run executes immediately: review produces a verdict, task produces a complete result.',
        launchError: 'Launch failed: {message}',
        runTitle: 'Real run',
        runIdleHint: 'No real run yet; click Run for real to have the models produce opinions.',
        taskRunIdleHint: 'No real run yet; click Run for real to have the experts deliver and merge the result.',
        stageTitle: 'Stages',
        stageIndependent: 'Independent',
        stageCross: 'Cross-examination',
        stagePeer: 'Peer review (deep)',
        stageVerdict: 'Chair verdict',
        stageSkipped: 'Skipped',
        stageActive: 'Active',
        stageDone: 'Done',
        stagePending: 'Pending',
        runStatusRunning: 'Running',
        runStatusFinished: 'Finished',
        runStatusFailed: 'Failed',
        runStatusCanceled: 'Canceled',
        runProvider: 'Model',
        runTokensLabel: 'Usage',
        runDurationLabel: 'Duration',
        unitMs: 'ms',
        unitSeconds: 's',
        runBudgetLabel: 'Budget',
        runErrorLabel: 'Error',
        runExpertsTitle: 'Expert status',
        runExpertEmpty: 'No expert results yet',
        runExpertsSummary: '{count} expert calls (details in the report)',
        runExpertOk: 'OK',
        runExpertDegraded: 'Degraded',
        runExpertFailed: 'Failed',
        runExpertRunning: 'Running',
        runFailedExperts: '{count} expert(s) failed',
        runQuorum: 'Quorum {success}/{required}',
        runQuorumMissing: 'Below quorum: fewer independent opinions than required, so confidence drops',
        cancelRun: 'Cancel',
        canceling: 'Canceling…',
        cancelRunDone: 'Canceled',
        cancelRunFailed: 'Cancel failed: {message}',
        reportTitle: 'Full report',
        reportView: 'View full report',
        reportDownload: 'Download Markdown',
        reportLoading: 'Loading report…',
        reportFailed: 'Report failed: {message}',
        reportClose: 'Close',
        reportMarker: 'Report',
        artifactDelivered: 'Delivered',
        artifactNotes: 'Artifact notes',
        emptyGuideTitle: 'No consults yet',
        emptyGuideHint: 'Pick a team/domain → say whether you want a review or a direct deliverable → run for real',
        emptyGuideStep1: 'Pick a team or domain',
        emptyGuideStep2: 'Say whether you want a review or a direct deliverable',
        emptyGuideStep3: 'Click Run for real to start the panel',
        expertDomainLabel: 'Domain (optional)',
        expertDomainNone: 'Not assigned',
        consentNotice: 'Only when you explicitly start it: the model never convenes a consult on its own, and this is unrelated to DSH Agent Teams.',
        consentNoticeOff: 'The explicit-invocation gate is off: the model may also convene a consult. It remains independent from DSH Agent Teams.',
        newTeam: 'New team',
        resetCustom: 'Reset customization',
        resetConfirm: 'Reset clears every custom expert and team and restores the built-in catalog. Continue?',
        confirmReset: 'Confirm reset',
        cancel: 'Cancel',
        save: 'Save',
        saving: 'Saving…',
        working: 'Working…',
        saveFailed: 'Save failed: {message}',
        deleteFailed: 'Delete failed: {message}',
        resetFailed: 'Reset failed: {message}',
        resetDone: 'Customization reset; the built-in catalog is restored',
        deletedDone: 'Deleted: {id}',
        hiddenDone: 'Hidden built-in: {id} (restore with Reset customization)',
        teamSaved: 'Team saved',
        expertSaved: 'Expert saved',
        editTeam: 'Edit team',
        editExpert: 'Edit expert',
        newExpert: 'New expert',
        remove: 'Delete',
        badgeCustom: 'Custom',
        badgeOverridden: 'Overridden',
        badgePreset: 'Built-in',
        incompleteTeam: 'Team incomplete',
        incompleteTeamHint: 'Its members were deleted; edit the team and add members before convening.',
        confirmDelete: 'Confirm delete',
        deletePresetTeam: 'Hide this built-in template? It disappears from the list and can be restored with Reset customization.',
        deleteCustomTeam: 'Delete this custom team? This cannot be undone.',
        deletePresetExpert: 'Hide this built-in expert? Teams using it lose a member; restore with Reset customization.',
        deleteCustomExpert: 'Delete this custom expert? This cannot be undone.',
        groupLabel: 'Group',
        idLabel: 'ID',
        nameZh: 'Chinese name',
        nameEn: 'English name',
        taglineLabel: 'Tagline',
        linesHint: 'One per line',
        pairsLabel: 'Complementary experts (pairs)',
        pairsHint: 'One expert id per line',
        budgetLeanLabel: 'Lean budget',
        budgetStandardLabel: 'Standard budget',
        budgetDeepLabel: 'Deep budget',
        membersHint: 'Pick members and mark exactly one chair with the radio',
        errIdInvalid: 'id must start lowercase, digits and - allowed, 2–41 chars',
        errNameZh: 'Chinese name needs at least 2 characters',
        errMandate: 'Mandate needs at least 8 characters',
        errLens: 'Lens cannot be empty',
        errAsks: 'At least one must-ask question',
        errRedLines: 'At least one red line',
        errMisses: 'Blind spots cannot be empty',
        errMembers: 'Pick at least one member',
        errLead: 'Exactly one chair is required',
        errBudgetOrder: 'Budgets must increase: lean ≤ standard ≤ deep, all positive',
        errAgenda: 'At least one agenda item',
        saveTeam: 'Save team',
        saveExpert: 'Save expert',
        errorNetwork: 'Network request failed',
        errorHttp: 'HTTP {status}',
        errorUnexpected: 'Unexpected response',
        errorUnknown: 'Unknown error',
      },
    }

    /**
     * Component-local styles. Rendered as a React `<style>` element inside the
     * panel so unmounting removes them. Only host theme tokens
     * (`--dsw-alias-*`) are used for surfaces and text, with neutral fallbacks;
     * the cool accent is used sparingly (rail glyph, active marker, links).
     */
    const STYLES = `
.ec-page {
  box-sizing: border-box;
  height: 100%;
  overflow-y: auto;
  scrollbar-gutter: stable;
  padding: 24px clamp(18px, 3vw, 40px) 40px;
  background: var(--dsw-alias-bg-base, transparent);
  color: var(--dsw-alias-label-primary, #1f2328);
  font-size: 13px;
  line-height: 20px;
  --ec-accent: #6d8df0;
  --ec-ink: var(--dsw-alias-label-primary, #1f2328);
  --ec-ink-2: var(--dsw-alias-label-secondary, #4b5563);
  --ec-ink-3: var(--dsw-alias-label-tertiary, #6b7280);
  --ec-ink-4: var(--dsw-alias-label-caption, #8b949e);
  --ec-surface: var(--dsw-alias-bg-layer-1, rgba(127, 127, 127, 0.06));
  --ec-surface-2: var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.1));
  --ec-line-1: var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.18));
  --ec-line-2: var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.28));
  --ec-line-3: var(--dsw-alias-border-l3, rgba(127, 127, 127, 0.42));
  --ec-hover: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.1));
  --ec-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --ec-blue: #3b82f6;
  --ec-green: var(--dsw-alias-state-success-primary, #2ea043);
  --ec-red: var(--dsw-alias-state-error-primary, #d92d20);
  --ec-amber: var(--dsw-alias-state-warn-primary, #d97706);
  --ec-gray: var(--dsw-alias-label-caption, #8b949e);
}
.ec-shell { max-width: 1180px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
.ec-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px 20px; flex-wrap: wrap; }
.ec-head-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.ec-head-title-row { display: flex; align-items: center; gap: 9px; }
.ec-head-glyph { display: inline-flex; color: var(--ec-accent); flex: none; }
.ec-title { margin: 0; font-size: 17px; line-height: 24px; font-weight: 600; color: var(--ec-ink); }
.ec-subtitle { margin: 0; font-size: 12px; line-height: 18px; color: var(--ec-ink-3); }
.ec-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
.ec-updated { font-size: 11.5px; line-height: 16px; color: var(--ec-ink-4); font-variant-numeric: tabular-nums; }
.ec-auto { font-size: 11px; line-height: 16px; color: var(--ec-ink-4); }
.ec-head-rule { height: 1px; background: var(--ec-line-2); }
.ec-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.ec-stat { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border: 0.5px solid var(--ec-line-2); border-radius: 10px; background: var(--ec-surface); min-width: 0; }
.ec-stat-label { font-size: 11px; line-height: 16px; letter-spacing: 0.04em; color: var(--ec-ink-3); }
.ec-stat-value { font-size: 19px; line-height: 25px; font-weight: 600; color: var(--ec-ink); font-variant-numeric: tabular-nums; }
.ec-btn { font: inherit; font-size: 12px; line-height: 18px; padding: 5px 12px; border-radius: 8px; border: 0.5px solid var(--ec-line-3); background: var(--ec-surface); color: var(--ec-ink-2); cursor: pointer; white-space: nowrap; transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease; }
.ec-btn:hover:not(:disabled) { background: var(--ec-hover); color: var(--ec-ink); }
.ec-btn:focus-visible { outline: 2px solid var(--ec-accent); outline-offset: 2px; }
.ec-btn:disabled { opacity: 0.5; cursor: default; }
.ec-btn-primary { background: var(--dsw-alias-button-primary-fill, #247bbf); border-color: var(--dsw-alias-button-primary-fill, #247bbf); color: var(--dsw-alias-label-primary-inverted, #fff); font-weight: 600; }
.ec-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover, #1f6da8); border-color: var(--dsw-alias-button-primary-hover, #1f6da8); color: var(--dsw-alias-label-primary-inverted, #fff); }
.ec-btn-sm { font-size: 11.5px; line-height: 16px; padding: 3px 10px; }
.ec-btn-danger { color: var(--ec-red); border-color: rgba(217, 45, 32, 0.45); }
.ec-btn-danger:hover:not(:disabled) { background: rgba(217, 45, 32, 0.1); color: var(--ec-red); }
.ec-section { display: flex; flex-direction: column; gap: 10px; padding-top: 14px; border-top: 0.5px solid var(--ec-line-1); scroll-margin-top: 12px; }
.ec-section-head { display: flex; align-items: baseline; gap: 9px; }
.ec-section-index { font-family: var(--ec-mono); font-size: 10.5px; line-height: 14px; color: var(--ec-accent); letter-spacing: 0.04em; flex: none; }
.ec-section-title { margin: 0; font-size: 11.5px; line-height: 16px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ec-ink-3); }
.ec-section-aside { margin-left: auto; font-size: 11px; line-height: 16px; color: var(--ec-ink-4); }
.ec-section-body { display: flex; flex-direction: column; gap: 10px; min-height: 6px; }
.ec-teams { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; }
.ec-team { display: flex; flex-direction: column; gap: 9px; padding: 14px; border: 0.5px solid var(--ec-line-2); border-radius: 12px; background: var(--ec-surface); min-width: 0; }
.ec-team-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.ec-team-name { margin: 0; font-size: 14px; line-height: 21px; font-weight: 600; color: var(--ec-ink); overflow-wrap: anywhere; }
.ec-team-tagline { margin: 0; font-size: 12px; line-height: 18px; color: var(--ec-ink-3); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.ec-chips { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
.ec-chip { display: inline-flex; align-items: center; gap: 5px; padding: 1px 8px; border-radius: 999px; border: 0.5px solid var(--ec-line-2); color: var(--ec-ink-2); font-size: 11px; line-height: 17px; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.ec-chip-mono { font-family: var(--ec-mono); font-size: 10.5px; color: var(--ec-ink-3); }
.ec-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--ec-tone, var(--ec-ink-4)); flex: none; }
.ec-tone-info { --ec-tone: var(--ec-blue); }
.ec-tone-waiting { --ec-tone: var(--ec-amber); }
.ec-tone-installed { --ec-tone: var(--ec-green); }
.ec-tone-blocked { --ec-tone: var(--ec-red); }
.ec-tone-archived { --ec-tone: var(--ec-gray); }
.ec-tone-muted { --ec-tone: var(--ec-ink-4); }
.ec-est-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; padding-top: 2px; }
.ec-est { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.ec-est-label { font-size: 10.5px; line-height: 14px; color: var(--ec-ink-4); white-space: nowrap; }
.ec-est-value { font-family: var(--ec-mono); font-size: 11.5px; line-height: 16px; color: var(--ec-ink-2); font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ec-est-title { font-size: 10.5px; line-height: 14px; letter-spacing: 0.04em; color: var(--ec-ink-4); text-transform: uppercase; }
.ec-team-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 2px; }
.ec-consult-list { display: flex; flex-direction: column; border-top: 0.5px solid var(--ec-line-1); }
.ec-consult-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: center; gap: 12px; padding: 10px 6px; border: 0; border-bottom: 0.5px solid var(--ec-line-1); background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; border-radius: 6px; }
.ec-consult-row:hover { background: var(--ec-hover); }
.ec-consult-row:focus-visible { outline: 2px solid var(--ec-accent); outline-offset: -2px; }
.ec-consult-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ec-consult-chips { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }
.ec-consult-report { font-family: var(--ec-mono); font-size: 10px; line-height: 15px; color: var(--ec-ink-4); border: 0.5px solid var(--ec-line-2); border-radius: 4px; padding: 0 4px; margin-left: 4px; }
.ec-consult-team { font-size: 11.5px; line-height: 16px; color: var(--ec-ink-3); }
.ec-consult-question { font-size: 12.5px; line-height: 18px; color: var(--ec-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ec-consult-decision { font-size: 11.5px; line-height: 16px; color: var(--ec-ink-4); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ec-consult-meta { font-family: var(--ec-mono); font-size: 10.5px; line-height: 15px; color: var(--ec-ink-4); white-space: nowrap; font-variant-numeric: tabular-nums; }
.ec-consult-time { font-family: var(--ec-mono); font-size: 10.5px; line-height: 15px; color: var(--ec-ink-4); white-space: nowrap; }
.ec-detail { display: flex; flex-direction: column; gap: 14px; outline: none; }
.ec-detail-head { display: flex; flex-direction: column; gap: 8px; }
.ec-back { align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; background: transparent; border: 0; padding: 2px 0; color: var(--ec-ink-3); font: inherit; font-size: 12px; cursor: pointer; border-radius: 4px; }
.ec-back:hover { color: var(--ec-ink); }
.ec-back:focus-visible { outline: 2px solid var(--ec-accent); outline-offset: 2px; }
.ec-detail-title { margin: 0; font-size: 16px; line-height: 23px; font-weight: 600; color: var(--ec-ink); overflow-wrap: anywhere; }
.ec-detail-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ec-mono { font-family: var(--ec-mono); font-size: 11px; line-height: 16px; color: var(--ec-ink-4); font-variant-numeric: tabular-nums; }
.ec-esc { margin-left: auto; font-family: var(--ec-mono); font-size: 10.5px; line-height: 14px; color: var(--ec-ink-4); }
.ec-field-grid { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 7px 12px; align-items: start; }
.ec-field-label { font-size: 11.5px; line-height: 18px; color: var(--ec-ink-4); padding-top: 1px; }
.ec-field-value { font-size: 12px; line-height: 18px; color: var(--ec-ink-2); overflow-wrap: anywhere; min-width: 0; }
.ec-raw { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12.5px; line-height: 19px; color: var(--ec-ink-2); border-left: 2px solid var(--ec-line-2); padding-left: 10px; }
.ec-context { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; line-height: 18px; color: var(--ec-ink-3); background: var(--ec-surface); border-radius: 8px; padding: 8px 10px; }
.ec-rules { border: 0.5px solid var(--ec-line-2); border-radius: 10px; background: var(--ec-surface); }
.ec-rules > summary { display: flex; align-items: center; gap: 9px; padding: 8px 12px; cursor: pointer; list-style: none; }
.ec-rules > summary::-webkit-details-marker { display: none; }
.ec-rules > summary:focus-visible { outline: 2px solid var(--ec-accent); outline-offset: 2px; border-radius: 10px; }
.ec-rules-list { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0 12px 12px; list-style: none; }
.ec-rule { display: flex; flex-direction: column; gap: 2px; padding-top: 8px; border-top: 0.5px solid var(--ec-line-1); }
.ec-rule-title { font-size: 12px; line-height: 17px; font-weight: 600; color: var(--ec-ink); }
.ec-rule-text { font-size: 12px; line-height: 18px; color: var(--ec-ink-3); overflow-wrap: anywhere; }
.ec-lens-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 10px; }
.ec-lens { display: flex; flex-direction: column; gap: 6px; padding: 11px 12px; border: 0.5px solid var(--ec-line-2); border-radius: 10px; background: var(--ec-surface); min-width: 0; }
.ec-lens-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ec-lens-name { margin: 0; font-size: 12.5px; line-height: 18px; font-weight: 600; color: var(--ec-ink); }
.ec-lens-mandate { margin: 0; font-size: 12px; line-height: 18px; color: var(--ec-ink-2); overflow-wrap: anywhere; }
.ec-lens-label { display: block; font-size: 10.5px; line-height: 15px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--ec-ink-4); margin: 2px 0 1px; }
.ec-lens-line { margin: 0; font-size: 11.5px; line-height: 17px; color: var(--ec-ink-3); overflow-wrap: anywhere; }
.ec-lens-block { display: flex; flex-direction: column; gap: 3px; }
.ec-ordered { display: flex; flex-direction: column; gap: 3px; margin: 0; padding-left: 17px; font-size: 11.5px; line-height: 17px; color: var(--ec-ink-3); }
.ec-bullets { display: flex; flex-direction: column; gap: 3px; margin: 0; padding-left: 15px; font-size: 12px; line-height: 18px; color: var(--ec-ink-3); }
.ec-two-col { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
.ec-block { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.ec-block-title { margin: 0; font-size: 11.5px; line-height: 16px; font-weight: 600; letter-spacing: 0.07em; text-transform: uppercase; color: var(--ec-ink-3); }
.ec-form { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 0.5px solid var(--ec-line-2); border-radius: 12px; background: var(--ec-surface); }
.ec-form-title { margin: 0; font-size: 12.5px; line-height: 18px; font-weight: 600; color: var(--ec-ink-2); }
.ec-form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px 12px; align-items: start; }
.ec-form-row { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.ec-form-row-wide { grid-column: 1 / -1; }
.ec-label { font-size: 11.5px; line-height: 16px; color: var(--ec-ink-3); }
.ec-textarea { box-sizing: border-box; width: 100%; resize: vertical; font: inherit; font-size: 12.5px; line-height: 19px; padding: 8px 10px; border-radius: 8px; border: 0.5px solid var(--ec-line-2); background: var(--dsw-alias-bg-layer-2, var(--ec-surface)); color: var(--ec-ink); }
.ec-textarea::placeholder { color: var(--ec-ink-4); }
.ec-textarea:focus-visible, .ec-input:focus-visible, .ec-select:focus-visible { outline: 2px solid var(--ec-accent); outline-offset: 1px; border-color: var(--ec-accent); }
.ec-input, .ec-select { box-sizing: border-box; width: 100%; font: inherit; font-size: 12.5px; line-height: 19px; padding: 6px 9px; border-radius: 8px; border: 0.5px solid var(--ec-line-2); background: var(--dsw-alias-bg-layer-2, var(--ec-surface)); color: var(--ec-ink); }
.ec-input::placeholder { color: var(--ec-ink-4); }
.ec-hint { margin: 0; font-size: 11px; line-height: 16px; color: var(--ec-ink-4); overflow-wrap: anywhere; }
.ec-hint-warn { color: var(--ec-amber); }
.ec-form-foot { display: flex; align-items: center; justify-content: flex-end; gap: 10px; flex-wrap: wrap; }
.ec-form-error { margin: 0; font-size: 12px; line-height: 18px; color: var(--ec-red); overflow-wrap: anywhere; }
.ec-form-notice { display: flex; flex-direction: column; gap: 3px; margin: 0; padding: 8px 10px; border: 0.5px solid rgba(46, 160, 67, 0.4); border-radius: 8px; background: var(--ec-surface); font-size: 12px; line-height: 18px; color: var(--ec-ink-2); overflow-wrap: anywhere; }
.ec-form-notice .ec-mono { color: var(--ec-ink-2); }
.ec-verdict-grid { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 7px 12px; align-items: start; }
.ec-verdict-block { display: flex; flex-direction: column; gap: 4px; }
.ec-verdict-decision { margin: 0; font-size: 13px; line-height: 20px; font-weight: 600; color: var(--ec-ink); overflow-wrap: anywhere; }
.ec-dissent { display: flex; flex-direction: column; gap: 5px; padding: 8px 10px; border-left: 3px solid var(--ec-amber); border-radius: 0 8px 8px 0; background: var(--ec-surface); }
.ec-dissent-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ec-dissent-expert { font-size: 11.5px; line-height: 16px; font-weight: 600; color: var(--ec-ink-2); }
.ec-dissent-point { margin: 0; font-size: 12px; line-height: 18px; color: var(--ec-ink-2); overflow-wrap: anywhere; }
.ec-dissent-evidence { margin: 0; font-family: var(--ec-mono); font-size: 10.5px; line-height: 15px; color: var(--ec-ink-4); overflow-wrap: anywhere; }
.ec-disagreement { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 10px; padding-top: 8px; border-top: 0.5px solid var(--ec-line-1); }
.ec-disagreement-pair { font-size: 12px; line-height: 18px; color: var(--ec-ink-2); overflow-wrap: anywhere; }
.ec-disagreement-reason { grid-column: 1 / -1; margin: 0; font-size: 11.5px; line-height: 17px; color: var(--ec-ink-3); overflow-wrap: anywhere; }
.ec-round { border: 0.5px solid var(--ec-line-2); border-radius: 10px; background: var(--ec-surface); }
.ec-round > summary { display: flex; align-items: center; gap: 9px; padding: 7px 11px; cursor: pointer; list-style: none; font-size: 11.5px; line-height: 16px; color: var(--ec-ink-3); }
.ec-round > summary::-webkit-details-marker { display: none; }
.ec-round > summary:focus-visible { outline: 2px solid var(--ec-accent); outline-offset: 2px; border-radius: 10px; }
.ec-round > summary .ec-mono { color: var(--ec-ink-4); }
.ec-round-body { display: flex; flex-direction: column; gap: 8px; padding: 0 11px 11px; }
.ec-opinion { display: flex; flex-direction: column; gap: 4px; padding-top: 8px; border-top: 0.5px solid var(--ec-line-1); }
.ec-opinion-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ec-opinion-expert { font-size: 12px; line-height: 17px; font-weight: 600; color: var(--ec-ink); }
.ec-opinion-conf { font-family: var(--ec-mono); font-size: 10.5px; line-height: 14px; color: var(--ec-ink-4); }
.ec-claim { display: flex; flex-direction: column; gap: 1px; margin: 0; }
.ec-claim-text { font-size: 12px; line-height: 18px; color: var(--ec-ink-2); overflow-wrap: anywhere; }
.ec-claim-evidence { margin: 0; font-family: var(--ec-mono); font-size: 10.5px; line-height: 15px; color: var(--ec-ink-4); overflow-wrap: anywhere; }
.ec-actionbar { position: sticky; bottom: 0; z-index: 2; display: flex; flex-direction: column; gap: 8px; padding: 10px 0 8px; border-top: 0.5px solid var(--ec-line-2); background: var(--dsw-alias-bg-base, #f6f7f8); }
.ec-actionbar-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ec-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 40px 20px; border: 0.5px dashed var(--ec-line-2); border-radius: 12px; text-align: center; }
.ec-empty-glyph { color: var(--ec-accent); opacity: 0.9; }
.ec-empty-title { margin: 0; font-size: 14px; line-height: 20px; font-weight: 600; color: var(--ec-ink-2); }
.ec-empty-hint { margin: 0; max-width: 460px; font-size: 12px; line-height: 18px; color: var(--ec-ink-3); }
.ec-state { display: flex; align-items: center; justify-content: center; min-height: 180px; font-size: 12.5px; color: var(--ec-ink-3); border-top: 0.5px solid var(--ec-line-1); }
.ec-feedback { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 0; padding: 8px 11px; border-radius: 9px; border: 0.5px solid var(--ec-line-2); background: var(--ec-surface); font-size: 12px; line-height: 18px; color: var(--ec-ink-2); }
.ec-feedback-error { border-color: rgba(217, 45, 32, 0.4); color: var(--ec-red); }
.ec-feedback-text { min-width: 0; overflow-wrap: anywhere; }
.ec-empty-inline { margin: 0; font-size: 12px; line-height: 18px; color: var(--ec-ink-4); }
.ec-notice { display: flex; flex-direction: column; gap: 2px; padding: 9px 11px; border: 0.5px solid var(--ec-line-2); border-left: 2px solid var(--ec-accent); border-radius: 8px; background: var(--ec-surface); font-size: 12px; line-height: 18px; color: var(--ec-ink-2); }
.ec-notice .ec-hint { color: var(--ec-ink-4); }
.ec-section-head-main { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.ec-section-head-line { display: flex; align-items: baseline; gap: 9px; min-width: 0; flex-wrap: wrap; }
.ec-section-desc { margin: 0; max-width: 760px; font-size: 11.5px; line-height: 17px; color: var(--ec-ink-4); }
.ec-head-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ec-badges { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.ec-card-warn { margin: 0; font-size: 11.5px; line-height: 17px; color: var(--ec-amber); }
.ec-detail-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ec-confirm { display: flex; flex-direction: column; gap: 8px; padding: 9px 11px; border: 0.5px solid rgba(217, 45, 32, 0.4); border-radius: 8px; background: var(--ec-surface); }
.ec-confirm-text { margin: 0; font-size: 12px; line-height: 18px; color: var(--ec-ink-2); overflow-wrap: anywhere; }
.ec-confirm-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ec-editor { display: flex; flex-direction: column; gap: 12px; padding: 12px; border: 0.5px solid var(--ec-line-2); border-radius: 12px; background: var(--ec-surface); }
.ec-editor-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px 12px; align-items: start; }
.ec-editor-section { display: flex; flex-direction: column; gap: 8px; padding-top: 10px; border-top: 0.5px solid var(--ec-line-1); }
.ec-editor-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; padding-top: 10px; border-top: 0.5px solid var(--ec-line-1); }
.ec-members { display: flex; flex-direction: column; gap: 4px; max-height: 280px; overflow: auto; border: 0.5px solid var(--ec-line-2); border-radius: 8px; padding: 6px 8px; background: var(--dsw-alias-bg-layer-2, var(--ec-surface)); }
.ec-member { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 3px 0; font-size: 12px; line-height: 18px; color: var(--ec-ink-2); }
.ec-member-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ec-member-role { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; line-height: 16px; color: var(--ec-ink-4); white-space: nowrap; }
.ec-checkbox, .ec-radio { accent-color: var(--ec-accent); }
.ec-expert-list { display: flex; flex-direction: column; border-top: 0.5px solid var(--ec-line-1); }
.ec-expert-row { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1.6fr) auto; gap: 10px; align-items: center; padding: 9px 4px; border-bottom: 0.5px solid var(--ec-line-1); }
.ec-expert-name { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ec-expert-title { font-size: 12.5px; line-height: 18px; font-weight: 600; color: var(--ec-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ec-expert-sub { font-size: 10.5px; line-height: 15px; color: var(--ec-ink-4); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ec-expert-mandate { margin: 0; font-size: 11.5px; line-height: 17px; color: var(--ec-ink-3); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.ec-expert-actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; flex-wrap: wrap; }
.ec-row-error { grid-column: 1 / -1; margin: 0; font-size: 11.5px; line-height: 17px; color: var(--ec-red); }
.ec-feedback-ok { border-color: rgba(46, 160, 67, 0.4); color: var(--ec-ink-2); }
.ec-nl { display: flex; flex-direction: column; gap: 9px; padding: 12px; border: 0.5px solid var(--ec-line-2); border-radius: 12px; background: var(--ec-surface); }
.ec-nl-input { min-height: 56px; }
.ec-examples { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.ec-examples-label { font-size: 10.5px; line-height: 15px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--ec-ink-4); }
.ec-example { font: inherit; font-size: 11px; line-height: 17px; padding: 2px 9px; border-radius: 999px; border: 0.5px dashed var(--ec-line-3); background: transparent; color: var(--ec-ink-3); cursor: pointer; text-align: left; transition: color 0.12s ease, border-color 0.12s ease; }
.ec-example:hover { color: var(--ec-ink); border-color: var(--ec-accent); }
.ec-example:focus-visible { outline: 2px solid var(--ec-accent); outline-offset: 2px; }
.ec-history { display: flex; flex-direction: column; border-top: 0.5px solid var(--ec-line-1); }
.ec-history-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; gap: 6px 12px; align-items: start; padding: 8px 4px; border-bottom: 0.5px solid var(--ec-line-1); }
.ec-history-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ec-history-summary { margin: 0; font-size: 12px; line-height: 18px; color: var(--ec-ink-2); overflow-wrap: anywhere; }
.ec-history-request { margin: 0; font-size: 11px; line-height: 16px; color: var(--ec-ink-4); overflow-wrap: anywhere; }
.ec-history-time { font-family: var(--ec-mono); font-size: 10.5px; line-height: 15px; color: var(--ec-ink-4); white-space: nowrap; }
.ec-actor { font-size: 10.5px; line-height: 15px; color: var(--ec-ink-4); white-space: nowrap; }
.ec-notice-warn { border-left-color: var(--ec-amber); }
.ec-domains { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; }
.ec-domain { display: flex; flex-direction: column; gap: 8px; padding: 13px; border: 0.5px solid var(--ec-line-2); border-radius: 12px; background: var(--ec-surface); text-align: left; color: inherit; font: inherit; cursor: pointer; }
.ec-card-note { margin: 0; font-size: 10.5px; line-height: 15px; color: var(--ec-ink-4); border-left: 2px solid var(--ec-line-2); padding-left: 6px; }
.ec-domain:hover { border-color: var(--ec-line-3); }
.ec-domain:focus-visible { outline: 2px solid var(--ec-accent); outline-offset: 2px; }
.ec-domain-on { border-color: var(--ec-accent); box-shadow: inset 0 0 0 1px var(--ec-accent); }
.ec-domain-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.ec-domain-name { margin: 0; font-size: 14px; line-height: 20px; font-weight: 600; color: var(--ec-ink); overflow-wrap: anywhere; }
.ec-domain-tagline { margin: 0; font-size: 12px; line-height: 18px; color: var(--ec-ink-3); }
.ec-domain-block { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.ec-domain-label { font-size: 10.5px; line-height: 15px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--ec-ink-4); }
.ec-domain-experts { display: flex; flex-wrap: wrap; gap: 5px; }
.ec-evidence { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
.ec-evidence li { font-size: 11px; line-height: 16px; color: var(--ec-ink-3); overflow-wrap: anywhere; }
.ec-evidence-id { font-family: var(--ec-mono); color: var(--ec-accent); margin-right: 4px; }
.ec-domain-flags { display: flex; flex-wrap: wrap; gap: 5px; }
.ec-flag { font-size: 10.5px; line-height: 15px; color: var(--ec-ink-3); border: 0.5px solid var(--ec-line-1); border-radius: 999px; padding: 0 7px; }
.ec-domain-artifacts { margin: 0; padding-left: 15px; font-size: 11px; line-height: 16px; color: var(--ec-ink-3); }
.ec-launch { display: flex; flex-direction: column; gap: 9px; padding: 13px; border: 0.5px solid var(--ec-line-2); border-radius: 12px; background: var(--ec-surface); }
.ec-launch-title { margin: 0; font-size: 12.5px; line-height: 18px; font-weight: 600; color: var(--ec-ink-2); }
.ec-launch-row { display: grid; grid-template-columns: minmax(0, 1fr) 190px; gap: 10px 12px; align-items: start; }
.ec-launch-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ec-launch-intent { display: flex; flex-direction: column; gap: 6px; }
.ec-intent-options { display: flex; flex-wrap: wrap; gap: 8px; }
.ec-intent-option { display: flex; flex-direction: column; gap: 2px; align-items: flex-start; padding: 7px 10px; border: 0.5px solid var(--ec-line-2); border-radius: 9px; background: var(--ec-surface); color: var(--ec-ink-3); font: inherit; cursor: pointer; text-align: left; }
.ec-intent-option:hover { border-color: var(--ec-line-3); }
.ec-intent-option:focus-visible { outline: 2px solid var(--ec-accent); outline-offset: 2px; }
.ec-intent-option-on { border-color: var(--ec-accent); color: var(--ec-ink); box-shadow: inset 0 0 0 1px var(--ec-accent); }
.ec-intent-option-label { font-size: 12px; line-height: 17px; font-weight: 600; }
.ec-intent-option-when { font-size: 10.5px; line-height: 15px; color: var(--ec-ink-4); }
.ec-task-result { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 0.5px solid var(--ec-line-2); border-left: 3px solid var(--ec-accent); border-radius: 0 10px 10px 0; background: var(--ec-surface); }
.ec-task-title { margin: 0; font-size: 15px; line-height: 22px; font-weight: 600; color: var(--ec-ink); overflow-wrap: anywhere; }
.ec-report-cta { display: flex; flex-direction: column; gap: 6px; padding: 10px; border: 0.5px dashed var(--ec-line-3); border-radius: 9px; }
.ec-consult-taskmark { color: var(--ec-accent); border-color: var(--ec-accent); }
.ec-run { display: flex; flex-direction: column; gap: 8px; }
.ec-run-meta { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 11.5px; line-height: 17px; color: var(--ec-ink-3); }
.ec-run-meta .ec-mono { color: var(--ec-ink-2); }
.ec-stages { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
.ec-stage { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border: 0.5px solid var(--ec-line-2); border-radius: 999px; font-size: 11px; line-height: 16px; color: var(--ec-ink-4); }
.ec-stage-on { border-color: var(--ec-accent); color: var(--ec-ink); }
.ec-stage-done { border-color: rgba(46, 160, 67, 0.5); color: var(--ec-ink-2); }
.ec-stage-skip { opacity: 0.6; text-decoration: line-through; }
.ec-run-warn { margin: 0; font-size: 11.5px; line-height: 17px; color: var(--ec-amber); overflow-wrap: anywhere; }
.ec-run-error { margin: 0; font-size: 11.5px; line-height: 17px; color: var(--ec-red); overflow-wrap: anywhere; }
.ec-expert-table { display: flex; flex-direction: column; border-top: 0.5px solid var(--ec-line-1); }
.ec-expert-status-row { display: grid; grid-template-columns: minmax(0, 1.4fr) auto auto auto; gap: 8px 12px; align-items: center; padding: 6px 4px; border-bottom: 0.5px solid var(--ec-line-1); font-size: 12px; line-height: 17px; color: var(--ec-ink-2); }
.ec-expert-status-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ec-expert-status-meta { font-family: var(--ec-mono); font-size: 10.5px; line-height: 15px; color: var(--ec-ink-4); white-space: nowrap; }
.ec-artifacts { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 0; list-style: none; }
.ec-artifact { display: flex; align-items: center; gap: 8px; font-size: 12px; line-height: 18px; color: var(--ec-ink-2); }
.ec-artifact-box { width: 12px; height: 12px; border-radius: 3px; border: 1px solid var(--ec-line-3); flex: none; display: inline-flex; align-items: center; justify-content: center; font-size: 9px; line-height: 1; color: transparent; }
.ec-artifact-on .ec-artifact-box { background: var(--ec-green); border-color: var(--ec-green); color: #fff; }
.ec-artifact-status { font-size: 10.5px; line-height: 15px; color: var(--ec-ink-4); margin-left: auto; white-space: nowrap; }
.ec-report-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ec-modal-backdrop { position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(0, 0, 0, 0.5); }
.ec-modal { display: flex; flex-direction: column; gap: 10px; width: min(860px, 100%); max-height: 86vh; padding: 14px; border: 0.5px solid var(--ec-line-3); border-radius: 12px; background: var(--dsw-alias-bg-base, #1b1d22); }
.ec-modal-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ec-modal-title { margin: 0; font-size: 14px; line-height: 20px; font-weight: 600; color: var(--ec-ink); }
.ec-modal-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ec-report-text { margin: 0; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--ec-mono); font-size: 11.5px; line-height: 18px; color: var(--ec-ink-2); }
.ec-guide { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; }
.ec-guide-step { display: flex; align-items: center; gap: 8px; font-size: 12px; line-height: 18px; color: var(--ec-ink-2); }
.ec-guide-num { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; border: 0.5px solid var(--ec-line-3); font-family: var(--ec-mono); font-size: 10px; color: var(--ec-accent); flex: none; }
@media (max-width: 720px) {
  .ec-launch-row { grid-template-columns: minmax(0, 1fr); }
  .ec-expert-status-row { grid-template-columns: minmax(0, 1fr) auto; }
  .ec-expert-status-row .ec-expert-status-meta:last-child { grid-column: 2; }
  .ec-modal-backdrop { padding: 10px; }
  .ec-intent-options { flex-direction: column; }
  .ec-intent-option { width: 100%; }
}
@media (max-width: 720px) {
  .ec-history-row { grid-template-columns: minmax(0, 1fr) auto; }
  .ec-actor { grid-column: 2; }
  .ec-history-time { grid-column: 1 / -1; }
  .ec-examples { flex-wrap: wrap; }
}
@media (max-width: 720px) {
  .ec-head-actions { margin-left: 0; width: 100%; justify-content: flex-start; }
  .ec-expert-row { grid-template-columns: minmax(0, 1fr) auto; }
  .ec-expert-mandate { grid-column: 1 / -1; }
  .ec-expert-actions { grid-column: 1 / -1; justify-content: flex-start; }
  .ec-member { grid-template-columns: auto minmax(0, 1fr); }
  .ec-member-role { grid-column: 2; }
  .ec-editor-actions { justify-content: flex-start; }
}
@media (max-width: 720px) {
  .ec-page { padding: 18px 14px 32px; }
  .ec-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ec-consult-row { grid-template-columns: auto minmax(0, 1fr); }
  .ec-consult-meta, .ec-consult-time { grid-column: 2; }
  .ec-field-grid, .ec-verdict-grid { grid-template-columns: minmax(0, 1fr); }
  .ec-field-label { padding-top: 0; }
  .ec-form-grid { grid-template-columns: minmax(0, 1fr); }
  .ec-team-actions { justify-content: stretch; }
  .ec-team-actions .ec-btn { flex: 1 1 auto; text-align: center; }
}
@media (prefers-reduced-motion: reduce) {
  .ec-page *, .ec-page *::before, .ec-page *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
`

    /** Council glyph: three lenses/figure nodes around a shared table marker. */
    function CouncilIcon(props) {
      const size = typeof props.size === 'number' && props.size > 0 ? props.size : 18
      const active = props.active === true
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          'aria-hidden': true,
          focusable: 'false',
          style: { display: 'block' },
        },
        h('circle', { cx: 12, cy: 7.6, r: 2.2, stroke: 'currentColor', strokeWidth: 1.7 }),
        h('path', {
          d: 'M8.6 16.2c0-1.9 1.5-3.4 3.4-3.4s3.4 1.5 3.4 3.4',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
        }),
        h('circle', { cx: 4.8, cy: 9.4, r: 1.6, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', {
          d: 'M2.4 14.6c.2-1.5 1.3-2.5 2.8-2.6',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
        }),
        h('circle', { cx: 19.2, cy: 9.4, r: 1.6, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', {
          d: 'M21.6 14.6c-.2-1.5-1.3-2.5-2.8-2.6',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
        }),
        h('circle', { cx: 12, cy: 18.4, r: 1.15, fill: active ? '#93acff' : ACCENT }),
      )
    }

    function BackIcon() {
      return h(
        'svg',
        {
          width: 14,
          height: 14,
          viewBox: '0 0 24 24',
          fill: 'none',
          'aria-hidden': true,
          focusable: 'false',
          style: { display: 'block' },
        },
        h('path', {
          d: 'M13.5 5.5 8 12l5.5 6.5',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    /** Locale lookup with safe interpolation for `{name}` placeholders. */
    function format(template, vars) {
      if (typeof template !== 'string') return ''
      if (!vars) return template
      return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) =>
        Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match,
      )
    }

    function createTranslator(base) {
      const source = typeof base === 'function' ? base : () => ''
      return (key, vars) => {
        let value = ''
        try {
          value = source(key, vars)
        } catch (error) {
          value = ''
        }
        if (typeof value !== 'string' || value.length === 0) value = key
        return format(value, vars)
      }
    }

    function finite(value) {
      return typeof value === 'number' && Number.isFinite(value)
    }

    function nonEmpty(value) {
      return typeof value === 'string' && value.length > 0
    }

    function timestampOf(value) {
      return finite(value) && value > 0 ? value : 0
    }

    function formatNumber(value) {
      try {
        return new Intl.NumberFormat().format(Math.round(Number(value) || 0))
      } catch (error) {
        return String(Math.round(Number(value) || 0))
      }
    }

    function percentText(t, ratio) {
      if (!finite(ratio)) return t('unknown')
      const percent = Math.max(0, Math.min(100, Math.round(ratio * 100)))
      return t('confidenceValue', { value: percent })
    }

    function clockText(timestamp) {
      try {
        return new Date(timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      } catch (error) {
        return ''
      }
    }

    function dateTimeText(timestamp) {
      try {
        return new Date(timestamp).toLocaleString(undefined, {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
      } catch (error) {
        return ''
      }
    }

    function excerpt(text, limit) {
      if (!nonEmpty(text)) return ''
      const single = text.replace(/\s+/g, ' ').trim()
      const max = typeof limit === 'number' && limit > 0 ? limit : 120
      return single.length > max ? `${single.slice(0, max)}…` : single
    }

    /** Picks the active language out of a `{zh, en}` Host value. */
    function pickName(lang, value) {
      if (nonEmpty(value)) return value
      if (value && typeof value === 'object') {
        if (nonEmpty(value[lang])) return value[lang]
        if (nonEmpty(value.zh)) return value.zh
        if (nonEmpty(value.en)) return value.en
      }
      return ''
    }

    function memberName(lang, team, expertId) {
      if (!nonEmpty(expertId)) return ''
      if (team && Array.isArray(team.members)) {
        const member = team.members.find((item) => item && item.id === expertId)
        if (member) {
          const named = pickName(lang, member.name)
          if (named) return named
        }
      }
      return expertId
    }

    function councilError(key, vars) {
      const error = new Error(key)
      error.councilKey = key
      if (vars) error.councilVars = vars
      return error
    }

    function describeError(t, error) {
      if (error && typeof error.councilKey === 'string') return t(error.councilKey, error.councilVars || {})
      if (error instanceof Error && nonEmpty(error.message)) return error.message
      if (nonEmpty(error)) return error
      return t('errorUnknown')
    }

    function documentHidden() {
      return typeof document !== 'undefined' && document.hidden === true
    }

    function prefersReducedMotion() {
      try {
        return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
          ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
          : false
      } catch (error) {
        return false
      }
    }

    /** Reads a client service only when the Host actually exposes it. */
    function safeService(ctx, name) {
      if (!ctx || typeof ctx !== 'object') return null
      if (typeof ctx.get === 'function') {
        try {
          const value = ctx.get(name)
          if (value !== undefined && value !== null) return value
        } catch (error) {
          // Not injected; fall through to `ctx[name]`.
        }
      }
      try {
        const value = ctx[name]
        if (value !== undefined && value !== null) return value
      } catch (error) {
        return null
      }
      return null
    }

    function readSessionId(value) {
      if (nonEmpty(value)) return value
      if (value && typeof value === 'object') {
        if (nonEmpty(value.id)) return value.id
        if (nonEmpty(value.sessionId)) return value.sessionId
        if (value.session && typeof value.session === 'object' && nonEmpty(value.session.id)) return value.session.id
      }
      return null
    }

    /** Same-origin request plumbing; every request carries the plugin header. */
    function requestInit(method, body) {
      const headers = {}
      headers[HEADER_NAME] = '1'
      const init = { method, headers, cache: 'no-store' }
      if (body !== undefined) {
        headers['content-type'] = 'application/json'
        init.body = JSON.stringify(body)
      }
      return init
    }

    async function readJsonSafe(response) {
      try {
        return await response.json()
      } catch (error) {
        return null
      }
    }

    function responseError(response, value) {
      const message = value && nonEmpty(value.error) ? value.error : null
      if (message) return new Error(message)
      return councilError('errorHttp', { status: response.status })
    }

    async function apiGet(path, query) {
      let suffix = ''
      if (query) {
        try {
          suffix = `?${new URLSearchParams(query).toString()}`
        } catch (error) {
          suffix = ''
        }
      }
      let response
      try {
        response = await fetch(`${path}${suffix}`, requestInit('GET'))
      } catch (error) {
        throw councilError('errorNetwork')
      }
      const value = await readJsonSafe(response)
      if (!response.ok) throw responseError(response, value)
      if (value === null || typeof value !== 'object') throw councilError('errorUnexpected')
      if (value.ok === false) throw responseError(response, value)
      return value
    }

    async function apiPost(body) {
      let response
      try {
        response = await fetch(API_ACTION, requestInit('POST', body))
      } catch (error) {
        throw councilError('errorNetwork')
      }
      const value = await readJsonSafe(response)
      if (!response.ok || (value && value.ok === false)) throw responseError(response, value)
      if (value === null || typeof value !== 'object') throw councilError('errorUnexpected')
      return value
    }

    /** GET a text/markdown route; a JSON body means the Host rejected the read. */
    async function apiGetText(path, query) {
      let suffix = ''
      if (query) {
        try {
          suffix = `?${new URLSearchParams(query).toString()}`
        } catch (error) {
          suffix = ''
        }
      }
      let response
      try {
        response = await fetch(`${path}${suffix}`, requestInit('GET'))
      } catch (error) {
        throw councilError('errorNetwork')
      }
      const type = response.headers && typeof response.headers.get === 'function' ? response.headers.get('content-type') : ''
      const text = await response.text()
      if (!response.ok) {
        let value = null
        try {
          value = JSON.parse(text)
        } catch (error) {
          value = null
        }
        throw responseError(response, value)
      }
      if (typeof type === 'string' && type.includes('application/json')) {
        let value = null
        try {
          value = JSON.parse(text)
        } catch (error) {
          value = null
        }
        if (value && value.ok === false) throw responseError(response, value)
        throw councilError('errorUnexpected')
      }
      return text
    }

    /** Save markdown as a local file without a server round-trip. */
    function downloadMarkdown(filename, text) {
      try {
        if (typeof document === 'undefined' || typeof Blob !== 'function' || typeof URL === 'undefined') {
          throw councilError('errorUnexpected')
        }
        const blob = new Blob([String(text ?? '')], { type: 'text/markdown;charset=utf-8' })
        const href = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = href
        link.download = filename
        link.rel = 'noopener'
        document.body.appendChild(link)
        link.click()
        link.remove()
        window.setTimeout(() => {
          try {
            URL.revokeObjectURL(href)
          } catch (error) {
            // Revoking is best effort.
          }
        }, 1000)
        return true
      } catch (error) {
        if (error && error.councilKey) throw error
        throw councilError('errorUnexpected')
      }
    }

    /**
     * Starts a session with the convening brief.
     *
     * Preferred path (when the Host exposes the client `sessions` service):
     * create -> retain -> `prompt([...], 'queue')` -> `uiWorkspace.openSession`.
     * Fallback: `uiWorkspace.startSession(undefined, { prompt, whenDraftExists: 'append' })`,
     * where the brief lands in the composer as an unsent draft.
     * Returns `{ mode: 'session' | 'draft', sessionId }`.
     */
    async function startSessionWithBrief(ctx, brief) {
      const sessions = safeService(ctx, 'sessions')
      const workspace = safeService(ctx, 'uiWorkspace')
      let lastError = null
      if (sessions && typeof sessions.create === 'function') {
        try {
          const created = await sessions.create()
          const sessionId = readSessionId(created)
          let handle = null
          if (typeof sessions.retain === 'function') {
            try {
              handle = await sessions.retain(sessionId || created)
            } catch (error) {
              lastError = error
            }
          }
          if (!handle && created && typeof created === 'object' && typeof created.prompt === 'function') {
            handle = created
          }
          if (!handle && sessionId && typeof sessions.get === 'function') {
            try {
              handle = await sessions.get(sessionId)
            } catch (error) {
              lastError = error
            }
          }
          if (sessionId && handle && typeof handle.prompt === 'function') {
            await handle.prompt([{ type: 'text', text: brief }], 'queue')
            if (workspace && typeof workspace.openSession === 'function') workspace.openSession(sessionId)
            return { mode: 'session', sessionId }
          }
        } catch (error) {
          lastError = error
        }
      }
      if (workspace && typeof workspace.startSession === 'function') {
        const started = await workspace.startSession(undefined, { prompt: brief, whenDraftExists: 'append' })
        return { mode: 'draft', sessionId: readSessionId(started) }
      }
      throw lastError || councilError('errorUnexpected')
    }

    /* ------------------------------------------------------------------ */
    /* Host vocabularies (status, mode, stance).                            */
    /* ------------------------------------------------------------------ */

    const STATUS_KEYS = { open: 'statusOpen', verdict: 'statusVerdict', archived: 'statusArchived' }
    const STATUS_TONES = { open: 'info', verdict: 'installed', archived: 'archived' }

    const MODE_VALUES = ['lean', 'standard', 'deep']
    const MODE_KEYS = { lean: 'modeLean', standard: 'modeStandard', deep: 'modeDeep' }
    const MODE_WHEN_KEYS = { lean: 'modeLeanWhen', standard: 'modeStandardWhen', deep: 'modeDeepWhen' }
    const MODE_TONES = { lean: 'muted', standard: 'info', deep: 'waiting' }

    const STANCE_KEYS = { support: 'stanceSupport', oppose: 'stanceOppose', conditional: 'stanceConditional' }
    const STANCE_TONES = { support: 'installed', oppose: 'blocked', conditional: 'waiting' }

    const DISAGREEMENT_KIND_KEYS = { stance: 'kindStance', confidence: 'kindConfidence' }

    /** Customisation audit actions rendered in the recent-changes list. */
    const HISTORY_ACTION_KEYS = {
      'expert-create': 'actionExpertCreate',
      'expert-override': 'actionExpertOverride',
      'expert-delete': 'actionExpertDelete',
      'expert-hide': 'actionExpertHide',
      'team-create': 'actionTeamCreate',
      'team-override': 'actionTeamOverride',
      'team-delete': 'actionTeamDelete',
      'team-hide': 'actionTeamHide',
      reset: 'actionReset',
    }

    function historyActionLabel(t, action) {
      if (typeof action === 'string' && Object.prototype.hasOwnProperty.call(HISTORY_ACTION_KEYS, action)) {
        return t(HISTORY_ACTION_KEYS[action])
      }
      return nonEmpty(action) ? action : t('unknown')
    }

    /* ------------------------------------------------------------------ */
    /* Intent vocabulary: a review judges, a task delivers an artifact.     */
    /* ------------------------------------------------------------------ */

    const INTENT_IDS = ['review', 'task']

    function intentLabel(t, intent) {
      return intent === 'task' ? t('intentTask') : t('intentReview')
    }

    function IntentChip(props) {
      const task = props.intent === 'task'
      return h(Chip, { dot: false, tone: task ? 'info' : 'muted', label: intentLabel(props.t, props.intent) })
    }

    /** Host-provided intent order, localised through the panel dictionaries. */
    function intentOptions(t, protocol) {
      const raw = protocol && Array.isArray(protocol.intents) ? protocol.intents : []
      const ids = raw
        .map((item) => (item && nonEmpty(item.id) ? item.id : ''))
        .filter((id) => INTENT_IDS.includes(id))
      const ordered = ids.length > 0 ? [...new Set(ids)] : INTENT_IDS
      return ordered.map((id) => ({
        id,
        label: intentLabel(t, id),
        when: id === 'task' ? t('intentTaskWhen') : t('intentReviewWhen'),
        description: id === 'task' ? t('intentTaskDesc') : t('intentReviewDesc'),
      }))
    }

    function defaultIntent(protocol) {
      const value =
        protocol && protocol.defaults && typeof protocol.defaults === 'object' ? protocol.defaults.intent : null
      return INTENT_IDS.includes(value) ? value : 'review'
    }

    /* ------------------------------------------------------------------ */
    /* Real-run vocabulary: statuses, expert states and the stage ladder.   */
    /* ------------------------------------------------------------------ */

    const RUN_STATUS_KEYS = {
      running: 'runStatusRunning',
      finished: 'runStatusFinished',
      failed: 'runStatusFailed',
      canceled: 'runStatusCanceled',
    }
    const RUN_STATUS_TONES = { running: 'waiting', finished: 'installed', failed: 'blocked', canceled: 'muted' }

    const EXPERT_STATUS_KEYS = {
      ok: 'runExpertOk',
      degraded: 'runExpertDegraded',
      failed: 'runExpertFailed',
      running: 'runExpertRunning',
    }
    const EXPERT_STATUS_TONES = { ok: 'installed', degraded: 'waiting', failed: 'blocked', running: 'info' }

    const RUN_STAGE_KEYS = ['stageIndependent', 'stageCross', 'stagePeer', 'stageVerdict']
    const TASK_STAGE_KEYS = ['stageWork', 'stageMerge']

    function stageKeysFor(intent) {
      return intent === 'task' ? TASK_STAGE_KEYS : RUN_STAGE_KEYS
    }

    function RunStatusChip(props) {
      const tone = RUN_STATUS_TONES[props.status] || 'muted'
      return h(Chip, { tone, label: dictLabel(props.t, RUN_STATUS_KEYS, props.status, 'unknown') })
    }

    function ExpertStatusChip(props) {
      const tone = EXPERT_STATUS_TONES[props.status] || 'muted'
      return h(Chip, { dot: false, tone, label: dictLabel(props.t, EXPERT_STATUS_KEYS, props.status, 'unknown') })
    }

    /** Map the executor stage string onto the ladder of one intent. */
    function stageIndexOf(stage, intent) {
      if (intent === 'task') {
        switch (stage) {
          case 'work':
            return 0
          case 'merge':
            return 1
          case 'report':
          case 'finished':
            return 2
          default:
            return -1
        }
      }
      switch (stage) {
        case 'independent':
        case 'independent-done':
        case 'independent-recorded':
          return 0
        case 'cross-exam':
        case 'cross-exam-done':
          return 1
        case 'peer-review':
        case 'peer-review-done':
          return 2
        case 'verdict':
          return 3
        case 'report':
        case 'finished':
          return 4
        default:
          return -1
      }
    }

    function stageStateOf(mode, intent, index, run) {
      const total = stageKeysFor(intent).length
      if (intent !== 'task' && index === 2 && mode !== 'deep') return 'skip'
      if (!run) return 'pending'
      if (run.status === 'finished') return 'done'
      const current = stageIndexOf(run.stage, intent)
      if (run.status === 'running') {
        if (index < current || current >= total) return 'done'
        if (index === current) return 'active'
        return 'pending'
      }
      if (run.status === 'failed' || run.status === 'canceled') {
        return current >= 0 && index < current ? 'done' : 'pending'
      }
      return 'pending'
    }

    function stageStateLabel(t, state) {
      if (state === 'done') return t('stageDone')
      if (state === 'active') return t('stageActive')
      if (state === 'skip') return t('stageSkipped')
      return t('stagePending')
    }

    function stageStateClass(state) {
      if (state === 'done') return ' ec-stage-done'
      if (state === 'active') return ' ec-stage-on'
      if (state === 'skip') return ' ec-stage-skip'
      return ''
    }

    function formatDuration(t, milliseconds) {
      if (!finite(milliseconds) || milliseconds <= 0) return t('unknown')
      if (milliseconds < 1000) return `${Math.round(milliseconds)} ${t('unitMs')}`
      return `${(milliseconds / 1000).toFixed(1)} ${t('unitSeconds')}`
    }

    function dictLabel(t, map, value, fallbackKey) {
      if (typeof value === 'string' && Object.prototype.hasOwnProperty.call(map, value)) return t(map[value])
      return t(fallbackKey || 'unknown')
    }

    function statusLabel(t, status) {
      return dictLabel(t, STATUS_KEYS, status, 'unknown')
    }

    function statusTone(status) {
      if (typeof status === 'string' && Object.prototype.hasOwnProperty.call(STATUS_TONES, status)) return STATUS_TONES[status]
      return 'muted'
    }

    /* ------------------------------------------------------------------ */
    /* Data hooks.                                                          */
    /* ------------------------------------------------------------------ */

    function useCouncilState() {
      const [snapshot, setSnapshot] = React.useState({
        data: null,
        error: null,
        loading: true,
        busy: false,
        updatedAt: 0,
      })
      const ticket = React.useRef(0)

      const load = React.useCallback(async (manual) => {
        const current = ++ticket.current
        if (manual === true) setSnapshot((previous) => ({ ...previous, busy: true }))
        try {
          const value = await apiGet(API_STATE)
          if (current !== ticket.current) return
          setSnapshot({ data: value, error: null, loading: false, busy: false, updatedAt: Date.now() })
        } catch (error) {
          if (current !== ticket.current) return
          setSnapshot((previous) => ({ ...previous, error, loading: false, busy: false }))
        }
      }, [])

      React.useEffect(() => {
        let disposed = false
        const tick = () => {
          if (disposed || documentHidden()) return
          void load(false)
        }
        tick()
        const timer = window.setInterval(tick, REFRESH_MS)
        const onVisibility = () => {
          if (!documentHidden()) tick()
        }
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
          document.addEventListener('visibilitychange', onVisibility)
        }
        return () => {
          disposed = true
          ticket.current += 1
          window.clearInterval(timer)
          if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
            document.removeEventListener('visibilitychange', onVisibility)
          }
        }
      }, [load])

      return {
        data: snapshot.data,
        error: snapshot.error,
        loading: snapshot.loading,
        busy: snapshot.busy,
        updatedAt: snapshot.updatedAt,
        reload: load,
      }
    }

    function useConsultDetail(id, revision) {
      const [state, setState] = React.useState({
        consult: null,
        team: null,
        domain: null,
        reportAvailable: false,
        loading: true,
        error: null,
        missing: false,
      })
      const ticket = React.useRef(0)

      React.useEffect(() => {
        if (!nonEmpty(id)) {
          setState({
            consult: null,
            team: null,
            domain: null,
            reportAvailable: false,
            loading: false,
            error: null,
            missing: false,
          })
          return undefined
        }
        let cancelled = false
        let timer = null
        const current = ++ticket.current
        const stopTimer = () => {
          if (timer !== null) {
            window.clearTimeout(timer)
            timer = null
          }
        }

        const fetchOnce = async (initial) => {
          if (cancelled) return
          if (initial) setState((previous) => ({ ...previous, loading: true, error: null }))
          try {
            const value = await apiGet(API_CONSULT, { id })
            if (cancelled || current !== ticket.current) return
            const consult = value && value.consult && typeof value.consult === 'object' ? value.consult : null
            const team = value && value.team && typeof value.team === 'object' ? value.team : null
            const domain = value && value.domain && typeof value.domain === 'object' ? value.domain : null
            setState({
              consult,
              team,
              domain,
              reportAvailable: Boolean(value && value.reportAvailable === true),
              loading: false,
              error: null,
              missing: consult === null,
            })
            const run = consult && consult.run && typeof consult.run === 'object' ? consult.run : null
            if (run && run.status === 'running') {
              // Live progress: refresh this consult faster than the list poll.
              stopTimer()
              timer = window.setTimeout(() => {
                void fetchOnce(false)
              }, RUN_POLL_MS)
            }
          } catch (error) {
            if (cancelled || current !== ticket.current) return
            setState((previous) => ({ ...previous, loading: false, error }))
          }
        }

        void fetchOnce(true)
        return () => {
          cancelled = true
          stopTimer()
        }
      }, [id, revision])

      return state
    }

    /* ------------------------------------------------------------------ */
    /* Small presentational components.                                     */
    /* ------------------------------------------------------------------ */

    function Chip(props) {
      const classes = ['ec-chip']
      if (props.tone) classes.push(`ec-tone-${props.tone}`)
      return h(
        'span',
        { className: classes.join(' '), title: props.title || undefined },
        props.dot === false ? null : h('span', { className: 'ec-dot' }),
        h('span', null, props.label),
        props.value === undefined || props.value === null || props.value === ''
          ? null
          : h('span', { className: 'ec-chip-mono' }, props.value),
      )
    }

    function StatusChip(props) {
      return h(Chip, { tone: statusTone(props.status), label: statusLabel(props.t, props.status) })
    }

    function ModeChip(props) {
      const tone = MODE_TONES[props.mode] || 'muted'
      return h(Chip, { tone, label: dictLabel(props.t, MODE_KEYS, props.mode, 'unknown') })
    }

    function StanceChip(props) {
      const tone = STANCE_TONES[props.stance] || 'muted'
      return h(Chip, { tone, label: dictLabel(props.t, STANCE_KEYS, props.stance, 'unknown') })
    }

    function Section(props) {
      const children = Array.isArray(props.children) ? props.children : [props.children]
      return h(
        'section',
        { className: 'ec-section', id: props.id || undefined },
        h(
          'div',
          { className: 'ec-section-head' },
          h('span', { className: 'ec-section-index' }, props.index),
          h('h2', { className: 'ec-section-title' }, props.title),
          props.aside ? h('span', { className: 'ec-section-aside' }, props.aside) : null,
        ),
        h('div', { className: 'ec-section-body' }, ...children),
      )
    }

    function ErrorBar(props) {
      return h(
        'div',
        { className: 'ec-feedback ec-feedback-error', role: 'alert' },
        h('span', { className: 'ec-feedback-text' }, props.message),
        props.onRetry ? h('button', { type: 'button', className: 'ec-btn ec-btn-sm', onClick: props.onRetry }, props.retryLabel) : null,
      )
    }

    function EmptyState(props) {
      return h(
        'div',
        { className: 'ec-empty' },
        props.showGlyph ? h('span', { className: 'ec-empty-glyph' }, h(CouncilIcon, { size: 26 })) : null,
        h('p', { className: 'ec-empty-title' }, props.title),
        h('p', { className: 'ec-empty-hint' }, props.hint),
      )
    }

    function BackButton(props) {
      return h(
        'button',
        { type: 'button', className: 'ec-back', onClick: props.onClick, 'aria-label': props.t('closeDetail') },
        h(BackIcon, null),
        h('span', null, props.t('backToList')),
      )
    }

    function PageHeader(props) {
      return h(
        'header',
        { className: 'ec-head' },
        h(
          'div',
          { className: 'ec-head-main' },
          h(
            'div',
            { className: 'ec-head-title-row' },
            h('span', { className: 'ec-head-glyph' }, h(CouncilIcon, { size: 20 })),
            h('h1', { className: 'ec-title' }, props.t('title')),
          ),
          h('p', { className: 'ec-subtitle' }, props.t('subtitle')),
        ),
        h(
          'div',
          { className: 'ec-toolbar' },
          props.updatedAt ? h('span', { className: 'ec-updated' }, props.t('updated', { time: clockText(props.updatedAt) })) : null,
          h('button', { type: 'button', className: 'ec-btn', onClick: props.onRefresh, disabled: props.busy }, props.busy ? props.t('refreshing') : props.t('refresh')),
          h('span', { className: 'ec-auto' }, props.t('autoRefresh')),
        ),
      )
    }

    function StatsRow(props) {
      const items = [
        { key: 'statTeams', value: props.stats.teams },
        { key: 'statExperts', value: props.stats.experts },
        { key: 'statConsults', value: props.stats.consults },
        { key: 'statTokens', value: props.stats.tokens },
      ]
      return h(
        'div',
        { className: 'ec-stats' },
        items.map((item) =>
          h(
            'div',
            { key: item.key, className: 'ec-stat' },
            h('span', { className: 'ec-stat-label' }, props.t(item.key)),
            h('span', { className: 'ec-stat-value' }, finite(item.value) ? formatNumber(item.value) : props.t('unknown')),
          ),
        ),
      )
    }

    function EstimateRow(props) {
      const t = props.t
      const estimates = props.estimates && typeof props.estimates === 'object' ? props.estimates : null
      const items = MODE_VALUES.map((mode) => ({
        mode,
        label: dictLabel(t, MODE_KEYS, mode, 'unknown'),
        value: estimates && finite(estimates[mode]) ? `${formatNumber(estimates[mode])} ${t('tokenUnit')}` : t('unknown'),
      }))
      return h(
        'div',
        null,
        h('div', { className: 'ec-est-title' }, t('estimatesLabel')),
        h(
          'div',
          { className: 'ec-est-row' },
          items.map((item) =>
            h(
              'div',
              { key: item.mode, className: 'ec-est' },
              h('span', { className: 'ec-est-label' }, item.label),
              h('span', { className: 'ec-est-value' }, item.value),
            ),
          ),
        ),
      )
    }

    /* ------------------------------------------------------------------ */
    /* Professional domains: cards, launch form, real-run progress.         */
    /* ------------------------------------------------------------------ */

    function DomainCard(props) {
      const t = props.t
      const lang = props.lang
      const domain = props.domain
      const selected = props.selected === true
      const experts = Array.isArray(domain.experts) ? domain.experts : []
      const evidence = domain.evidence && typeof domain.evidence === 'object' ? domain.evidence : null
      const levels = evidence && Array.isArray(evidence.levels) ? evidence.levels : []
      const required = evidence && Array.isArray(evidence.required) ? evidence.required : []
      const redFlags = evidence && Array.isArray(evidence.redFlags) ? evidence.redFlags : []
      const artifacts = Array.isArray(domain.artifacts) ? domain.artifacts : []
      return h(
        'button',
        {
          type: 'button',
          className: `ec-domain${selected ? ' ec-domain-on' : ''}`,
          'aria-pressed': selected,
          onClick: () => props.onSelect(domain.id),
        },
        h(
          'div',
          { className: 'ec-domain-head' },
          h('h3', { className: 'ec-domain-name' }, pickName(lang, domain.name) || domain.id),
          selected ? h(Chip, { tone: 'info', label: t('selectedLabel') }) : null,
        ),
        nonEmpty(domain.tagline) ? h('p', { className: 'ec-domain-tagline' }, domain.tagline) : null,
        h('p', { className: 'ec-card-note' }, t('lensBaseline')),
        experts.length > 0
          ? h(
              'div',
              { className: 'ec-domain-block' },
              h('span', { className: 'ec-domain-label' }, t('expertLenses')),
              h(
                'div',
                { className: 'ec-domain-experts' },
                experts.map((expert) =>
                  h(
                    'span',
                    { key: expert.id || pickName(lang, expert.name), className: 'ec-chip', title: nonEmpty(expert.mandate) ? expert.mandate : '' },
                    pickName(lang, expert.name) || expert.id,
                  ),
                ),
              ),
            )
          : null,
        levels.length > 0
          ? h(
              'div',
              { className: 'ec-domain-block' },
              h('span', { className: 'ec-domain-label' }, t('evidenceTitle')),
              h(
                'ul',
                { className: 'ec-evidence' },
                levels.map((level, index) =>
                  h(
                    'li',
                    { key: level.id || index },
                    h('span', { className: 'ec-evidence-id' }, nonEmpty(level.id) ? level.id : ''),
                    nonEmpty(level.label) ? level.label : '',
                    nonEmpty(level.meaning) ? ` · ${level.meaning}` : '',
                  ),
                ),
              ),
            )
          : null,
        required.length > 0
          ? h(
              'div',
              { className: 'ec-domain-block' },
              h('span', { className: 'ec-domain-label' }, t('evidenceRequired')),
              h('div', { className: 'ec-chips' }, required.map((item, index) => h('span', { key: index, className: 'ec-chip' }, item))),
            )
          : null,
        redFlags.length > 0
          ? h(
              'div',
              { className: 'ec-domain-block' },
              h('span', { className: 'ec-domain-label' }, t('redFlags')),
              h('div', { className: 'ec-domain-flags' }, redFlags.map((item, index) => h('span', { key: index, className: 'ec-flag' }, item))),
            )
          : null,
        artifacts.length > 0
          ? h(
              'div',
              { className: 'ec-domain-block' },
              h('span', { className: 'ec-domain-label' }, t('artifactsLabel')),
              h('ul', { className: 'ec-domain-artifacts' }, artifacts.map((item, index) => h('li', { key: index }, item))),
            )
          : null,
      )
    }

    function DomainLaunchForm(props) {
      const t = props.t
      const domain = props.domain
      const [question, setQuestion] = React.useState('')
      const [mode, setMode] = React.useState(domain && MODE_VALUES.includes(domain.defaultMode) ? domain.defaultMode : 'standard')
      const [intent, setIntent] = React.useState(defaultIntent(props.protocol))
      const [pending, setPending] = React.useState(null)
      const [error, setError] = React.useState(null)
      const busyRef = React.useRef(false)
      const questionMin = finite(props.questionMin) ? Math.max(1, Math.trunc(props.questionMin)) : QUESTION_MIN
      const intentChoices = intentOptions(t, props.protocol)
      const activeIntent = intentChoices.find((option) => option.id === intent) || intentChoices[0] || null
      const estimates =
        domain && domain.team && domain.team.estimates && typeof domain.team.estimates === 'object'
          ? domain.team.estimates
          : domain && domain.budget && typeof domain.budget === 'object'
            ? domain.budget
            : null
      const estimate = estimates && finite(estimates[mode]) ? estimates[mode] : null
      const runAvailable = props.llmAvailable !== false
      const text = question.trim()

      const submit = async (runNow) => {
        if (busyRef.current) return
        if (text.length < questionMin) {
          setError(t('questionTooShort', { min: questionMin }))
          return
        }
        busyRef.current = true
        setPending(runNow ? 'run' : 'convene')
        setError(null)
        try {
          await props.onLaunch({ domainId: domain.id, question: text, mode, intent, runNow })
          setQuestion('')
        } catch (failure) {
          setError(t('launchError', { message: describeError(t, failure) }))
        } finally {
          busyRef.current = false
          setPending(null)
        }
      }

      return h(
        'div',
        { className: 'ec-launch' },
        h('h3', { className: 'ec-launch-title' }, t('domainLaunchTitle')),
        h(
          'div',
          { className: 'ec-launch-intent' },
          h('span', { className: 'ec-label' }, t('intentLabel')),
          h(
            'div',
            { className: 'ec-intent-options', role: 'group', 'aria-label': t('intentLabel') },
            intentChoices.map((option) =>
              h(
                'button',
                {
                  key: option.id,
                  type: 'button',
                  className: `ec-intent-option${option.id === intent ? ' ec-intent-option-on' : ''}`,
                  'aria-pressed': option.id === intent,
                  onClick: () => setIntent(option.id),
                },
                h('span', { className: 'ec-intent-option-label' }, option.label),
                h('span', { className: 'ec-intent-option-when' }, option.when),
              ),
            ),
          ),
          activeIntent ? h('p', { className: 'ec-hint' }, activeIntent.description) : null,
        ),
        h(
          'div',
          { className: 'ec-launch-row' },
          h(
            'div',
            { className: 'ec-form-row' },
            h('label', { className: 'ec-label', htmlFor: 'ec-domain-question' }, t('questionLabel')),
            h('textarea', {
              id: 'ec-domain-question',
              className: 'ec-textarea',
              rows: 2,
              value: question,
              spellCheck: false,
              placeholder: t('questionPlaceholder'),
              onChange: (event) => setQuestion(event.target.value),
            }),
            h('p', { className: 'ec-hint' }, t('questionMeta', { count: text.length, min: questionMin })),
          ),
          h(
            'div',
            { className: 'ec-form-row' },
            h('label', { className: 'ec-label', htmlFor: 'ec-domain-mode' }, t('modeFieldLabel')),
            h(
              'select',
              {
                id: 'ec-domain-mode',
                className: 'ec-select',
                value: mode,
                onChange: (event) => setMode(event.target.value),
              },
              MODE_VALUES.map((value) => h('option', { key: value, value }, dictLabel(t, MODE_KEYS, value, 'unknown'))),
            ),
            h(
              'p',
              { className: 'ec-hint' },
              estimate === null ? t('unknown') : t('estimateHint', { cap: formatNumber(estimate) }),
            ),
            intent === 'task' ? h('p', { className: 'ec-hint' }, t('taskBudgetHint')) : null,
          ),
        ),
        h('p', { className: 'ec-hint' }, t('launchHint')),
        runAvailable ? null : h('p', { className: 'ec-run-warn' }, t('launchRunUnavailable')),
        error ? h('p', { className: 'ec-form-error', role: 'alert' }, error) : null,
        h(
          'div',
          { className: 'ec-launch-actions' },
          h(
            'button',
            { type: 'button', className: 'ec-btn', disabled: pending !== null, onClick: () => void submit(false) },
            pending === 'convene' ? t('working') : t('launchConvene'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'ec-btn ec-btn-primary',
              disabled: pending !== null || !runAvailable,
              title: runAvailable ? undefined : t('launchRunUnavailable'),
              onClick: () => void submit(true),
            },
            pending === 'run' ? t('working') : t('launchRun'),
          ),
        ),
      )
    }

    /** Stage ladder + run counters for one real consult run. */
    function RunTimeline(props) {
      const t = props.t
      const run = props.run && typeof props.run === 'object' ? props.run : null
      const snapshot = props.snapshot && typeof props.snapshot === 'object' ? props.snapshot : null
      if (!run && !snapshot) return null
      const declared = props.intent === 'task' ? 'task' : props.intent === 'review' ? 'review' : ''
      const intent =
        declared ||
        (run && run.intent === 'task' ? 'task' : '') ||
        (snapshot && snapshot.intent === 'task' ? 'task' : '') ||
        'review'
      const stageKeys = stageKeysFor(intent)
      const status = run && nonEmpty(run.status) ? run.status : snapshot && nonEmpty(snapshot.status) ? snapshot.status : ''
      const stage = run && nonEmpty(run.stage) ? run.stage : snapshot && nonEmpty(snapshot.stage) ? snapshot.stage : ''
      const tokens =
        run && finite(run.tokens)
          ? run.tokens
          : snapshot && snapshot.usage && finite(snapshot.usage.totalTokens)
            ? snapshot.usage.totalTokens
            : 0
      const budget = run && finite(run.budget) ? run.budget : snapshot && finite(snapshot.budget) ? snapshot.budget : 0
      const duration = run && finite(run.durationMs) ? run.durationMs : 0
      const provider = run && nonEmpty(run.provider) ? run.provider : snapshot && nonEmpty(snapshot.provider) ? snapshot.provider : ''
      const model = run && nonEmpty(run.model) ? run.model : snapshot && nonEmpty(snapshot.model) ? snapshot.model : ''
      const quorum = intent === 'task' ? null : snapshot && snapshot.quorum && typeof snapshot.quorum === 'object' ? snapshot.quorum : null
      const warnings = snapshot && Array.isArray(snapshot.warnings) ? snapshot.warnings.filter(nonEmpty).slice(0, 6) : []
      return h(
        'div',
        { className: 'ec-run' },
        h(
          'ul',
          { className: 'ec-stages', 'aria-label': t('stageTitle') },
          stageKeys.map((key, index) => {
            const state = stageStateOf(props.mode, intent, index, {
              status,
              stage,
            })
            return h(
              'li',
              { key, className: `ec-stage${stageStateClass(state)}` },
              h('span', null, t(key)),
              h('span', { className: 'ec-mono' }, stageStateLabel(t, state)),
            )
          }),
        ),
        h(
          'div',
          { className: 'ec-run-meta' },
          status ? h(RunStatusChip, { t, status }) : null,
          provider || model
            ? h('span', null, `${t('runProvider')}: `, h('span', { className: 'ec-mono' }, `${provider || '?'} / ${model || '?'}`))
            : null,
          h('span', null, `${t('runTokensLabel')}: `, h('span', { className: 'ec-mono' }, formatNumber(tokens))),
          run && finite(run.experts)
            ? h('span', null, `${t('runExpertsTitle')}: `, h('span', { className: 'ec-mono' }, formatNumber(run.experts)))
            : null,
          h(
            'span',
            null,
            `${t('runBudgetLabel')}: `,
            h('span', { className: 'ec-mono' }, `${formatNumber(budget)} ${t('tokenUnit')}`),
          ),
          duration > 0 ? h('span', null, `${t('runDurationLabel')}: `, h('span', { className: 'ec-mono' }, formatDuration(t, duration))) : null,
          quorum && finite(quorum.success) && finite(quorum.required)
            ? h('span', null, t('runQuorum', { success: quorum.success, required: quorum.required }))
            : null,
          run && finite(run.failedExperts) && run.failedExperts > 0
            ? h('span', null, t('runFailedExperts', { count: run.failedExperts }))
            : null,
        ),
        quorum && quorum.ok === false ? h('p', { className: 'ec-run-warn' }, t('runQuorumMissing')) : null,
        warnings.length > 0
          ? h('div', { className: 'ec-block' }, warnings.map((warning, index) => h('p', { key: `run-warning-${index}`, className: 'ec-run-warn' }, warning)))
          : null,
        run && nonEmpty(run.error)
          ? h('p', { className: 'ec-run-error' }, `${t('runErrorLabel')}: ${run.error}`)
          : null,
      )
    }

    function collectRunExperts(run, snapshot, rounds) {
      const byExpert = new Map()
      const record = (entry) => {
        if (!entry || typeof entry !== 'object') return
        const expert = nonEmpty(entry.expert) ? entry.expert : nonEmpty(entry.expertId) ? entry.expertId : ''
        if (!expert) return
        const status = nonEmpty(entry.status) ? entry.status : 'ok'
        const next = {
          expert,
          status,
          tokens: finite(entry.tokens) ? entry.tokens : 0,
          latencyMs: finite(entry.latencyMs) ? entry.latencyMs : 0,
        }
        const previous = byExpert.get(expert)
        if (!previous || (previous.status !== 'failed' && status === 'failed')) byExpert.set(expert, next)
        else if (previous.status !== 'failed' && next.tokens > previous.tokens) byExpert.set(expert, { ...previous, tokens: next.tokens })
      }
      if (run && Array.isArray(run.experts)) run.experts.forEach(record)
      if (snapshot && Array.isArray(snapshot.experts)) snapshot.experts.forEach(record)
      if (byExpert.size === 0 && Array.isArray(rounds)) {
        for (const round of rounds) {
          const opinions = round && Array.isArray(round.opinions) ? round.opinions : []
          for (const opinion of opinions) record({ expert: opinion.expert, status: 'ok', tokens: opinion.tokens })
        }
      }
      return [...byExpert.values()]
    }

    function RunExpertTable(props) {
      const t = props.t
      const lang = props.lang
      const entries = collectRunExperts(props.run, props.snapshot, props.rounds)
      if (entries.length === 0) {
        const calls = props.run && finite(props.run.experts) ? props.run.experts : 0
        return calls > 0
          ? h('p', { className: 'ec-empty-inline' }, t('runExpertsSummary', { count: formatNumber(calls) }))
          : h('p', { className: 'ec-empty-inline' }, t('runExpertEmpty'))
      }
      return h(
        'div',
        { className: 'ec-expert-table' },
        entries.map((entry) =>
          h(
            'div',
            { key: entry.expert, className: 'ec-expert-status-row' },
            h('span', { className: 'ec-expert-status-name', title: entry.expert }, memberName(lang, props.team, entry.expert) || t('unknownExpert')),
            h(ExpertStatusChip, { t, status: entry.status }),
            h('span', { className: 'ec-expert-status-meta' }, `${formatNumber(entry.tokens)} ${t('tokenUnit')}`),
            h('span', { className: 'ec-expert-status-meta' }, entry.latencyMs > 0 ? formatDuration(t, entry.latencyMs) : t('unknown')),
          ),
        ),
      )
    }

    function ReportModal(props) {
      const t = props.t
      const title = nonEmpty(props.title) ? props.title : t('reportTitle')
      const closeRef = React.useRef(null)
      React.useEffect(() => {
        const node = closeRef.current
        if (node && typeof node.focus === 'function') node.focus()
      }, [])
      React.useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopImmediatePropagation()
          props.onClose()
        }
        // Capture phase so Esc closes the dialog before the panel's back handler.
        window.addEventListener('keydown', onKeyDown, true)
        return () => {
          window.removeEventListener('keydown', onKeyDown, true)
        }
      }, [props.onClose])
      return h(
        'div',
        {
          className: 'ec-modal-backdrop',
          role: 'presentation',
          onClick: props.onClose,
        },
        h(
          'div',
          {
            className: 'ec-modal',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': title,
            onClick: (event) => event.stopPropagation(),
          },
          h(
            'div',
            { className: 'ec-modal-head' },
            h('h2', { className: 'ec-modal-title' }, title),
            h(
              'div',
              { className: 'ec-modal-actions' },
              props.onDownload ? h('button', { type: 'button', className: 'ec-btn ec-btn-sm', onClick: props.onDownload }, t('reportDownload')) : null,
              h('button', { type: 'button', className: 'ec-btn ec-btn-sm', ref: closeRef, onClick: props.onClose }, t('reportClose')),
            ),
          ),
          props.loading
            ? h('p', { className: 'ec-hint' }, t('reportLoading'))
            : props.error
              ? h('p', { className: 'ec-form-error', role: 'alert' }, t('reportFailed', { message: props.error }))
              : h('pre', { className: 'ec-report-text' }, props.text),
        ),
      )
    }

    function EmptyGuide(props) {
      const t = props.t
      return h(
        'div',
        { className: 'ec-empty' },
        h('p', { className: 'ec-empty-title' }, t('emptyGuideTitle')),
        h('p', { className: 'ec-empty-hint' }, t('emptyGuideHint')),
        h(
          'ol',
          { className: 'ec-guide' },
          [t('emptyGuideStep1'), t('emptyGuideStep2'), t('emptyGuideStep3')].map((step, index) =>
            h(
              'li',
              { key: index, className: 'ec-guide-step' },
              h('span', { className: 'ec-guide-num' }, String(index + 1)),
              h('span', null, step),
            ),
          ),
        ),
      )
    }

    /* ------------------------------------------------------------------ */
    /* Customisation: badges, consent notice, editors and expert catalog.  */
    /* ------------------------------------------------------------------ */

    const GROUP_IDS = ['structure', 'risk', 'user', 'execution']
    const ID_PATTERN = /^[a-z][a-z0-9-]{1,40}$/

    function isValidId(value) {
      return typeof value === 'string' && ID_PATTERN.test(value.trim())
    }

    function linesToArray(value) {
      if (typeof value !== 'string') return []
      return value
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    }

    function hasCustomization(customization) {
      if (!customization || typeof customization !== 'object') return false
      return ['customExperts', 'customTeams', 'hiddenExperts', 'hiddenTeams'].some(
        (key) => Array.isArray(customization[key]) && customization[key].length > 0,
      )
    }

    /** Where Esc / the back button goes from a given view. */
    function backTargetOf(view) {
      if (view && view.kind === 'team-edit') {
        return nonEmpty(view.teamId) ? { kind: 'team', teamId: view.teamId } : { kind: 'list' }
      }
      if (view && view.kind === 'expert-edit') return { kind: 'experts' }
      return { kind: 'list' }
    }

    function entityBadgeSpecs(t, entity) {
      if (!entity || typeof entity !== 'object') return []
      if (entity.custom === true && entity.preset === true) {
        return [{ key: 'overridden', label: t('badgeOverridden'), tone: 'waiting' }]
      }
      if (entity.custom === true) return [{ key: 'custom', label: t('badgeCustom'), tone: 'info' }]
      if (entity.preset === true) return [{ key: 'preset', label: t('badgePreset'), tone: 'muted' }]
      return []
    }

    function EntityBadges(props) {
      const specs = entityBadgeSpecs(props.t, props.entity)
      if (specs.length === 0) return null
      return h(
        'div',
        { className: 'ec-badges' },
        specs.map((spec) => h(Chip, { key: spec.key, tone: spec.tone, label: spec.label })),
      )
    }

    function groupOptions(protocol, lang) {
      const groups = protocol && Array.isArray(protocol.groups) ? protocol.groups.filter((group) => group && typeof group === 'object') : []
      const mapped = groups.map((group) => ({ id: group.id, label: pickName(lang, group.name) || group.id }))
      if (mapped.length > 0) return mapped
      return GROUP_IDS.map((id) => ({ id, label: id }))
    }

    function groupLabelFor(lang, protocol, groupId) {
      const option = groupOptions(protocol, lang).find((item) => item.id === groupId)
      if (option) return option.label
      return nonEmpty(groupId) ? groupId : ''
    }

    /** Passive consent banner: the panel never drives the gate, it only states it. */
    function ConsentNotice(props) {
      const t = props.t
      const policy = props.policy && typeof props.policy === 'object' ? props.policy : null
      const required = policy ? policy.requireExplicitConsent === true : true
      const boundary = policy && nonEmpty(policy.boundary) ? policy.boundary : null
      return h(
        'div',
        { className: 'ec-notice', role: 'note' },
        h('span', null, required ? t('consentNotice') : t('consentNoticeOff')),
        boundary ? h('span', { className: 'ec-hint' }, boundary) : null,
      )
    }

    function ConfirmRow(props) {
      return h(
        'div',
        { className: props.className || 'ec-confirm' },
        h('p', { className: 'ec-confirm-text' }, props.message),
        props.error ? h('p', { className: 'ec-form-error', role: 'alert' }, props.error) : null,
        h(
          'div',
          { className: 'ec-confirm-actions' },
          h(
            'button',
            { type: 'button', className: 'ec-btn ec-btn-danger ec-btn-sm', disabled: props.pending, onClick: props.onConfirm },
            props.pending ? props.t('working') : props.confirmLabel,
          ),
          h(
            'button',
            { type: 'button', className: 'ec-btn ec-btn-sm', disabled: props.pending, onClick: props.onCancel },
            props.t('cancel'),
          ),
        ),
      )
    }

    function MembersPicker(props) {
      const t = props.t
      const lang = props.lang
      const experts = Array.isArray(props.experts) ? props.experts : []
      const members = Array.isArray(props.members) ? props.members : []
      const lead = members.find((member) => member && member.role === 'lead')
      const isSelected = (id) => members.some((member) => member.id === id)

      const toggle = (expertId) => {
        if (isSelected(expertId)) {
          const next = members.filter((member) => member.id !== expertId)
          if (next.length > 0 && !next.some((member) => member.role === 'lead')) next[0] = { ...next[0], role: 'lead' }
          props.onChange(next)
          return
        }
        props.onChange(members.concat([{ id: expertId, role: members.length === 0 ? 'lead' : 'member' }]))
      }

      const setLead = (expertId) => {
        props.onChange(members.map((member) => ({ id: member.id, role: member.id === expertId ? 'lead' : 'member' })))
      }

      if (experts.length === 0) return h('p', { className: 'ec-empty-inline' }, t('unknown'))
      return h(
        'div',
        { className: 'ec-members', role: 'group', 'aria-label': t('membersLabel') },
        experts.map((expert) => {
          const selected = isSelected(expert.id)
          const name = pickName(lang, expert.name) || expert.id
          return h(
            'div',
            { key: expert.id, className: 'ec-member' },
            h('input', {
              className: 'ec-checkbox',
              type: 'checkbox',
              checked: selected,
              'aria-label': name,
              onChange: () => toggle(expert.id),
            }),
            h('span', { className: 'ec-member-name', title: name }, name),
            h(
              'label',
              { className: 'ec-member-role' },
              h('input', {
                className: 'ec-radio',
                type: 'radio',
                name: 'ec-lead',
                checked: selected && Boolean(lead) && lead.id === expert.id,
                disabled: !selected,
                onChange: () => setLead(expert.id),
              }),
              h('span', null, t('roleLead')),
            ),
          )
        }),
      )
    }

    function numberFieldValue(value, fallback) {
      return finite(value) ? String(Math.trunc(value)) : String(fallback)
    }

    function TeamEditor(props) {
      const t = props.t
      const lang = props.lang
      const team = props.team
      const experts = Array.isArray(props.experts) ? props.experts : []
      const editing = Boolean(team)
      const [id, setId] = React.useState(team ? team.id : '')
      const [nameZh, setNameZh] = React.useState(team && team.name && nonEmpty(team.name.zh) ? team.name.zh : '')
      const [nameEn, setNameEn] = React.useState(team && team.name && nonEmpty(team.name.en) ? team.name.en : '')
      const [tagline, setTagline] = React.useState(team && nonEmpty(team.tagline) ? team.tagline : '')
      const [intent, setIntent] = React.useState(team && nonEmpty(team.intent) ? team.intent : '')
      const [defaultMode, setDefaultMode] = React.useState(
        team && MODE_VALUES.includes(team.defaultMode) ? team.defaultMode : 'lean',
      )
      const [lean, setLean] = React.useState(numberFieldValue(team && team.budget ? team.budget.lean : null, 500))
      const [standard, setStandard] = React.useState(numberFieldValue(team && team.budget ? team.budget.standard : null, 1500))
      const [deep, setDeep] = React.useState(numberFieldValue(team && team.budget ? team.budget.deep : null, 3000))
      const [members, setMembers] = React.useState(
        team && Array.isArray(team.members)
          ? team.members.map((member) => ({ id: member.id, role: member.role === 'lead' ? 'lead' : 'member' }))
          : [],
      )
      const [agenda, setAgenda] = React.useState(team && Array.isArray(team.agenda) ? team.agenda.join('\n') : '')
      const [artifacts, setArtifacts] = React.useState(team && Array.isArray(team.artifacts) ? team.artifacts.join('\n') : '')
      const [pending, setPending] = React.useState(false)
      const [error, setError] = React.useState(null)
      const busyRef = React.useRef(false)

      const submit = async () => {
        if (busyRef.current) return
        const targetId = id.trim()
        if (!isValidId(targetId)) {
          setError(t('errIdInvalid'))
          return
        }
        if (nameZh.trim().length < 2) {
          setError(t('errNameZh'))
          return
        }
        if (members.length < 1) {
          setError(t('errMembers'))
          return
        }
        if (members.filter((member) => member.role === 'lead').length !== 1) {
          setError(t('errLead'))
          return
        }
        const leanValue = Number(lean.trim())
        const standardValue = Number(standard.trim())
        const deepValue = Number(deep.trim())
        if (
          !finite(leanValue) ||
          !finite(standardValue) ||
          !finite(deepValue) ||
          leanValue <= 0 ||
          standardValue <= 0 ||
          deepValue <= 0 ||
          leanValue > standardValue ||
          standardValue > deepValue
        ) {
          setError(t('errBudgetOrder'))
          return
        }
        const agendaLines = linesToArray(agenda)
        if (agendaLines.length < 1) {
          setError(t('errAgenda'))
          return
        }
        busyRef.current = true
        setPending(true)
        setError(null)
        try {
          const payload = {
            id: targetId,
            name: { zh: nameZh.trim(), en: nameEn.trim() || nameZh.trim() },
            tagline: tagline.trim(),
            intent: intent.trim(),
            defaultMode,
            members: members.map((member) => ({ id: member.id, role: member.role })),
            agenda: agendaLines,
            artifacts: linesToArray(artifacts),
            budget: { lean: Math.trunc(leanValue), standard: Math.trunc(standardValue), deep: Math.trunc(deepValue) },
          }
          const result = await props.onSave(payload)
          props.onSaved(result, targetId)
        } catch (failure) {
          setError(t('saveFailed', { message: describeError(t, failure) }))
        } finally {
          busyRef.current = false
          setPending(false)
        }
      }

      const row = (label, control, hint, wide) =>
        h(
          'div',
          { className: `ec-form-row${wide ? ' ec-form-row-wide' : ''}` },
          h('label', { className: 'ec-label' }, label),
          control,
          hint ? h('p', { className: 'ec-hint' }, hint) : null,
        )

      return h(
        'div',
        { className: 'ec-detail' },
        h(
          'div',
          { className: 'ec-detail-head' },
          h(BackButton, { t, onClick: props.onCancel }),
          h('h1', { className: 'ec-detail-title' }, editing ? t('editTeam') : t('newTeam')),
          h('span', { className: 'ec-esc' }, t('escHint')),
        ),
        h(
          'div',
          { className: 'ec-editor' },
          h(
            'div',
            { className: 'ec-editor-grid' },
            row(
              t('idLabel'),
              h('input', {
                className: 'ec-input',
                type: 'text',
                value: id,
                disabled: editing,
                onChange: (event) => setId(event.target.value),
              }),
              editing ? null : null,
            ),
            row(t('nameZh'), h('input', { className: 'ec-input', type: 'text', value: nameZh, onChange: (event) => setNameZh(event.target.value) })),
            row(t('nameEn'), h('input', { className: 'ec-input', type: 'text', value: nameEn, onChange: (event) => setNameEn(event.target.value) })),
            row(
              t('defaultMode'),
              h(
                'select',
                { className: 'ec-select', value: defaultMode, onChange: (event) => setDefaultMode(event.target.value) },
                MODE_VALUES.map((value) => h('option', { key: value, value }, dictLabel(t, MODE_KEYS, value, 'unknown'))),
              ),
            ),
            row(
              t('taglineLabel'),
              h('input', { className: 'ec-input', type: 'text', value: tagline, onChange: (event) => setTagline(event.target.value) }),
              null,
              true,
            ),
            row(
              t('teamIntent'),
              h('textarea', {
                className: 'ec-textarea',
                rows: 2,
                value: intent,
                onChange: (event) => setIntent(event.target.value),
              }),
              null,
              true,
            ),
            row(
              t('budgetLeanLabel'),
              h('input', { className: 'ec-input', type: 'text', inputMode: 'numeric', value: lean, onChange: (event) => setLean(event.target.value) }),
            ),
            row(
              t('budgetStandardLabel'),
              h('input', { className: 'ec-input', type: 'text', inputMode: 'numeric', value: standard, onChange: (event) => setStandard(event.target.value) }),
            ),
            row(
              t('budgetDeepLabel'),
              h('input', { className: 'ec-input', type: 'text', inputMode: 'numeric', value: deep, onChange: (event) => setDeep(event.target.value) }),
            ),
          ),
          h(
            'div',
            { className: 'ec-editor-section' },
            h('label', { className: 'ec-label' }, t('membersLabel')),
            h('p', { className: 'ec-hint' }, t('membersHint')),
            h(MembersPicker, { t, lang, experts, members, onChange: setMembers }),
          ),
          h(
            'div',
            { className: 'ec-editor-grid' },
            row(
              t('agendaLabel'),
              h('textarea', {
                className: 'ec-textarea',
                rows: 4,
                value: agenda,
                placeholder: t('linesHint'),
                onChange: (event) => setAgenda(event.target.value),
              }),
              t('linesHint'),
              true,
            ),
            row(
              t('artifactsLabel'),
              h('textarea', {
                className: 'ec-textarea',
                rows: 3,
                value: artifacts,
                placeholder: t('linesHint'),
                onChange: (event) => setArtifacts(event.target.value),
              }),
              t('linesHint'),
              true,
            ),
          ),
          error ? h('p', { className: 'ec-form-error', role: 'alert' }, error) : null,
          h(
            'div',
            { className: 'ec-editor-actions' },
            h('button', { type: 'button', className: 'ec-btn', disabled: pending, onClick: props.onCancel }, t('cancel')),
            h('button', { type: 'button', className: 'ec-btn ec-btn-primary', disabled: pending, onClick: () => void submit() }, pending ? t('saving') : t('saveTeam')),
          ),
        ),
      )
    }

    function ExpertEditor(props) {
      const t = props.t
      const lang = props.lang
      const expert = props.expert
      const editing = Boolean(expert)
      const [id, setId] = React.useState(expert ? expert.id : '')
      const [nameZh, setNameZh] = React.useState(expert && expert.name && nonEmpty(expert.name.zh) ? expert.name.zh : '')
      const [nameEn, setNameEn] = React.useState(expert && expert.name && nonEmpty(expert.name.en) ? expert.name.en : '')
      const [group, setGroup] = React.useState(expert && nonEmpty(expert.group) ? expert.group : GROUP_IDS[0])
      const [domain, setDomain] = React.useState(expert && nonEmpty(expert.domain) ? expert.domain : '')
      const [mandate, setMandate] = React.useState(expert && nonEmpty(expert.mandate) ? expert.mandate : '')
      const [lens, setLens] = React.useState(expert && nonEmpty(expert.lens) ? expert.lens : '')
      const [asks, setAsks] = React.useState(expert && Array.isArray(expert.asks) ? expert.asks.join('\n') : '')
      const [redLines, setRedLines] = React.useState(expert && Array.isArray(expert.redLines) ? expert.redLines.join('\n') : '')
      const [misses, setMisses] = React.useState(expert && nonEmpty(expert.misses) ? expert.misses : '')
      const [pairs, setPairs] = React.useState(expert && Array.isArray(expert.pairs) ? expert.pairs.join('\n') : '')
      const [standard, setStandard] = React.useState(
        numberFieldValue(expert && expert.budget ? expert.budget.standard : null, 120),
      )
      const [deep, setDeep] = React.useState(numberFieldValue(expert && expert.budget ? expert.budget.deep : null, 180))
      const [pending, setPending] = React.useState(false)
      const [error, setError] = React.useState(null)
      const busyRef = React.useRef(false)

      const submit = async () => {
        if (busyRef.current) return
        const targetId = id.trim()
        if (!isValidId(targetId)) {
          setError(t('errIdInvalid'))
          return
        }
        if (nameZh.trim().length < 2) {
          setError(t('errNameZh'))
          return
        }
        if (mandate.trim().length < 8) {
          setError(t('errMandate'))
          return
        }
        if (lens.trim().length < 2) {
          setError(t('errLens'))
          return
        }
        if (linesToArray(asks).length < 1) {
          setError(t('errAsks'))
          return
        }
        if (linesToArray(redLines).length < 1) {
          setError(t('errRedLines'))
          return
        }
        if (misses.trim().length < 2) {
          setError(t('errMisses'))
          return
        }
        const standardValue = Number(standard.trim())
        const deepValue = Number(deep.trim())
        if (
          !finite(standardValue) ||
          !finite(deepValue) ||
          standardValue <= 0 ||
          deepValue <= 0 ||
          deepValue < standardValue
        ) {
          setError(t('errBudgetOrder'))
          return
        }
        busyRef.current = true
        setPending(true)
        setError(null)
        try {
          const payload = {
            id: targetId,
            name: { zh: nameZh.trim(), en: nameEn.trim() || nameZh.trim() },
            group,
            domain: nonEmpty(domain) ? domain : null,
            mandate: mandate.trim(),
            lens: lens.trim(),
            asks: linesToArray(asks),
            redLines: linesToArray(redLines),
            misses: misses.trim(),
            pairs: linesToArray(pairs),
            // The form does not edit conflicts; carry them through so an override
            // does not wipe the expert's declared tensions.
            conflicts: expert && Array.isArray(expert.conflicts) ? expert.conflicts : [],
            budget: { standard: Math.trunc(standardValue), deep: Math.trunc(deepValue) },
          }
          const result = await props.onSave(payload)
          props.onSaved(result, targetId)
        } catch (failure) {
          setError(t('saveFailed', { message: describeError(t, failure) }))
        } finally {
          busyRef.current = false
          setPending(false)
        }
      }

      const row = (label, control, hint, wide) =>
        h(
          'div',
          { className: `ec-form-row${wide ? ' ec-form-row-wide' : ''}` },
          h('label', { className: 'ec-label' }, label),
          control,
          hint ? h('p', { className: 'ec-hint' }, hint) : null,
        )

      return h(
        'div',
        { className: 'ec-detail' },
        h(
          'div',
          { className: 'ec-detail-head' },
          h(BackButton, { t, onClick: props.onCancel }),
          h('h1', { className: 'ec-detail-title' }, editing ? t('editExpert') : t('newExpert')),
          h('span', { className: 'ec-esc' }, t('escHint')),
        ),
        h(
          'div',
          { className: 'ec-editor' },
          h(
            'div',
            { className: 'ec-editor-grid' },
            row(
              t('idLabel'),
              h('input', {
                className: 'ec-input',
                type: 'text',
                value: id,
                disabled: editing,
                onChange: (event) => setId(event.target.value),
              }),
            ),
            row(t('nameZh'), h('input', { className: 'ec-input', type: 'text', value: nameZh, onChange: (event) => setNameZh(event.target.value) })),
            row(t('nameEn'), h('input', { className: 'ec-input', type: 'text', value: nameEn, onChange: (event) => setNameEn(event.target.value) })),
            row(
              t('groupLabel'),
              h(
                'select',
                { className: 'ec-select', value: group, onChange: (event) => setGroup(event.target.value) },
                groupOptions(props.protocol, lang).map((option) =>
                  h('option', { key: option.id, value: option.id }, option.label),
                ),
              ),
            ),
            row(
              t('expertDomainLabel'),
              h(
                'select',
                { className: 'ec-select', value: domain, onChange: (event) => setDomain(event.target.value) },
                h('option', { value: '' }, t('expertDomainNone')),
                (Array.isArray(props.domains) ? props.domains : []).map((item) =>
                  h('option', { key: item.id, value: item.id }, pickName(lang, item.name) || item.id),
                ),
              ),
            ),
            row(
              t('mandateLabel'),
              h('textarea', {
                className: 'ec-textarea',
                rows: 3,
                value: mandate,
                onChange: (event) => setMandate(event.target.value),
              }),
              null,
              true,
            ),
            row(
              t('lensLabel'),
              h('input', { className: 'ec-input', type: 'text', value: lens, onChange: (event) => setLens(event.target.value) }),
              null,
              true,
            ),
          ),
          h(
            'div',
            { className: 'ec-editor-grid' },
            row(
              t('asksLabel'),
              h('textarea', {
                className: 'ec-textarea',
                rows: 4,
                value: asks,
                placeholder: t('linesHint'),
                onChange: (event) => setAsks(event.target.value),
              }),
              t('linesHint'),
              true,
            ),
            row(
              t('redLinesLabel'),
              h('textarea', {
                className: 'ec-textarea',
                rows: 3,
                value: redLines,
                placeholder: t('linesHint'),
                onChange: (event) => setRedLines(event.target.value),
              }),
              t('linesHint'),
              true,
            ),
            row(
              t('missesLabel'),
              h('textarea', {
                className: 'ec-textarea',
                rows: 2,
                value: misses,
                onChange: (event) => setMisses(event.target.value),
              }),
              null,
              true,
            ),
            row(
              t('pairsLabel'),
              h('textarea', {
                className: 'ec-textarea',
                rows: 2,
                value: pairs,
                placeholder: t('pairsHint'),
                onChange: (event) => setPairs(event.target.value),
              }),
              t('pairsHint'),
              true,
            ),
          ),
          h(
            'div',
            { className: 'ec-editor-grid' },
            row(
              t('budgetStandardLabel'),
              h('input', {
                className: 'ec-input',
                type: 'text',
                inputMode: 'numeric',
                value: standard,
                onChange: (event) => setStandard(event.target.value),
              }),
            ),
            row(
              t('budgetDeepLabel'),
              h('input', {
                className: 'ec-input',
                type: 'text',
                inputMode: 'numeric',
                value: deep,
                onChange: (event) => setDeep(event.target.value),
              }),
            ),
          ),
          error ? h('p', { className: 'ec-form-error', role: 'alert' }, error) : null,
          h(
            'div',
            { className: 'ec-editor-actions' },
            h('button', { type: 'button', className: 'ec-btn', disabled: pending, onClick: props.onCancel }, t('cancel')),
            h('button', { type: 'button', className: 'ec-btn ec-btn-primary', disabled: pending, onClick: () => void submit() }, pending ? t('saving') : t('saveExpert')),
          ),
        ),
      )
    }

    function ExpertsView(props) {
      const t = props.t
      const lang = props.lang
      const experts = Array.isArray(props.experts) ? props.experts : []
      const domains = Array.isArray(props.domains) ? props.domains : []
      const [confirmId, setConfirmId] = React.useState(null)
      const [pendingId, setPendingId] = React.useState(null)
      const [error, setError] = React.useState(null)
      const domainNameFor = (domainId) => {
        const domain = domains.find((item) => item && item.id === domainId)
        return domain ? pickName(lang, domain.name) || domain.id : domainId
      }

      const runDelete = async (expert) => {
        if (nonEmpty(pendingId)) return
        setPendingId(expert.id)
        setError(null)
        try {
          await props.onDelete('expert', expert.id)
          setConfirmId(null)
        } catch (failure) {
          setError({ id: expert.id, text: t('deleteFailed', { message: describeError(t, failure) }) })
        } finally {
          setPendingId(null)
        }
      }

      return h(
        'div',
        { className: 'ec-detail' },
        h(
          'div',
          { className: 'ec-detail-head' },
          h(BackButton, { t, onClick: props.onBack }),
          h('h1', { className: 'ec-detail-title' }, t('expertLenses')),
          h(
            'div',
            { className: 'ec-detail-meta' },
            h('span', { className: 'ec-mono' }, String(experts.length)),
            h('span', { className: 'ec-esc' }, t('escHint')),
          ),
          h(
            'div',
            { className: 'ec-detail-actions' },
            h('button', { type: 'button', className: 'ec-btn ec-btn-primary', onClick: props.onNew }, t('newExpert')),
          ),
        ),
        experts.length === 0
          ? h(EmptyState, { showGlyph: false, title: t('expertLenses'), hint: t('recentEmpty') })
          : h(
              'div',
              { className: 'ec-expert-list' },
              experts.map((expert) => {
                const name = pickName(lang, expert.name) || expert.id
                return h(
                  'div',
                  { key: expert.id, className: 'ec-expert-row' },
                  h(
                    'div',
                    { className: 'ec-expert-name' },
                    h('span', { className: 'ec-expert-title', title: name }, name),
                    h(
                      'span',
                      { className: 'ec-expert-sub' },
                      `${expert.id} · ${groupLabelFor(lang, props.protocol, expert.group)}${nonEmpty(expert.domain) ? ` · ${domainNameFor(expert.domain)}` : ''}`,
                    ),
                    h(EntityBadges, { t, entity: expert }),
                  ),
                  h('p', { className: 'ec-expert-mandate' }, nonEmpty(expert.mandate) ? expert.mandate : t('unknown')),
                  h(
                    'div',
                    { className: 'ec-expert-actions' },
                    h('button', { type: 'button', className: 'ec-btn ec-btn-sm', onClick: () => props.onEdit(expert.id) }, t('editExpert')),
                    h(
                      'button',
                      { type: 'button', className: 'ec-btn ec-btn-sm ec-btn-danger', onClick: () => setConfirmId(expert.id) },
                      t('remove'),
                    ),
                  ),
                  confirmId === expert.id
                    ? h(
                        'div',
                        { style: { gridColumn: '1 / -1' } },
                        h(ConfirmRow, {
                          t,
                          message: expert.preset === true ? t('deletePresetExpert') : t('deleteCustomExpert'),
                          confirmLabel: t('confirmDelete'),
                          pending: pendingId === expert.id,
                          onCancel: () => setConfirmId(null),
                          onConfirm: () => {
                            void runDelete(expert)
                          },
                        }),
                      )
                    : null,
                  error && error.id === expert.id ? h('p', { className: 'ec-row-error', role: 'alert' }, error.text) : null,
                )
              }),
            ),
      )
    }

    function TeamCard(props) {
      const t = props.t
      const lang = props.lang
      const team = props.team
      const members = Array.isArray(team.members) ? team.members : []
      const incomplete = team.incomplete === true
      return h(
        'article',
        { className: 'ec-team' },
        h(
          'div',
          { className: 'ec-team-head' },
          h('h3', { className: 'ec-team-name' }, pickName(lang, team.name)),
          h(ModeChip, { t, mode: team.defaultMode }),
        ),
        h(
          'div',
          { className: 'ec-badges' },
          h(EntityBadges, { t, entity: team }),
          incomplete ? h(Chip, { tone: 'blocked', label: t('incompleteTeam') }) : null,
        ),
        nonEmpty(team.tagline) ? h('p', { className: 'ec-team-tagline' }, team.tagline) : null,
        h('p', { className: 'ec-card-note' }, t('lensBaseline')),
        h(
          'div',
          { className: 'ec-chips' },
          members.map((member) => {
            const name = pickName(lang, member.name) || member.id
            const label = member.role === 'lead' ? `${name} · ${t('roleLead')}` : name
            return h(Chip, { key: member.id || name, tone: member.role === 'lead' ? 'info' : 'muted', label })
          }),
        ),
        h(EstimateRow, { t, estimates: team.estimates }),
        incomplete ? h('p', { className: 'ec-card-warn' }, t('incompleteTeamHint')) : null,
        h(
          'div',
          { className: 'ec-team-actions' },
          h(
            'button',
            {
              type: 'button',
              className: 'ec-btn ec-btn-primary',
              disabled: incomplete,
              title: incomplete ? t('incompleteTeamHint') : undefined,
              onClick: () => props.onConvene(team.id),
            },
            t('convene'),
          ),
          h('button', { type: 'button', className: 'ec-btn', onClick: () => props.onView(team.id) }, t('viewTeam')),
        ),
      )
    }

    /** Consistent business-section header: title, optional count/description, actions. */
    function SectionHeader(props) {
      return h(
        'div',
        { className: 'ec-section-head' },
        h(
          'div',
          { className: 'ec-section-head-main' },
          h(
            'div',
            { className: 'ec-section-head-line' },
            h('h2', { className: 'ec-section-title' }, props.title),
            props.count === undefined || props.count === null
              ? null
              : h('span', { className: 'ec-section-aside' }, String(props.count)),
          ),
          props.desc ? h('p', { className: 'ec-section-desc' }, props.desc) : null,
        ),
        props.actions ? h('div', { className: 'ec-head-actions' }, props.actions) : null,
      )
    }

    /** Plain-language customisation: one sentence in, a session brief out. */
    function NaturalLanguageRequest(props) {
      const t = props.t
      const [text, setText] = React.useState('')
      const [pending, setPending] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [notice, setNotice] = React.useState(null)
      const busyRef = React.useRef(false)
      const fieldRef = React.useRef(null)
      const examples = [t('nlExample1'), t('nlExample2'), t('nlExample3')]
      const empty = text.trim().length === 0

      const submit = async () => {
        if (busyRef.current) return
        const value = text.trim()
        if (value.length === 0) {
          setError(t('nlEmpty'))
          return
        }
        busyRef.current = true
        setPending(true)
        setError(null)
        setNotice(null)
        try {
          const outcome = await props.onSubmit(value)
          setText('')
          setNotice(outcome || {})
        } catch (failure) {
          setError(describeError(t, failure))
        } finally {
          busyRef.current = false
          setPending(false)
        }
      }

      const onKeyDown = (event) => {
        if (event.key !== 'Enter' || event.shiftKey) return
        event.preventDefault()
        void submit()
      }

      const fillExample = (example) => {
        setText(example)
        setError(null)
        setNotice(null)
        try {
          const node = fieldRef.current
          if (node && typeof node.focus === 'function') node.focus()
        } catch (focusError) {
          // Focusing is cosmetic.
        }
      }

      return h(
        'div',
        { className: 'ec-nl' },
        h(
          'div',
          { className: 'ec-form-row' },
          h('label', { className: 'ec-label', htmlFor: 'ec-nl-request' }, t('nlDesc')),
          h('textarea', {
            id: 'ec-nl-request',
            ref: fieldRef,
            className: 'ec-textarea ec-nl-input',
            rows: 2,
            value: text,
            spellCheck: false,
            placeholder: t('nlPlaceholder'),
            'aria-label': t('nlTitle'),
            onChange: (event) => setText(event.target.value),
            onKeyDown,
          }),
        ),
        h(
          'div',
          { className: 'ec-examples' },
          h('span', { className: 'ec-examples-label' }, t('nlExamples')),
          examples.map((example, index) =>
            h(
              'button',
              { key: `nl-example-${index}`, type: 'button', className: 'ec-example', onClick: () => fillExample(example) },
              example,
            ),
          ),
        ),
        h(
          'div',
          { className: 'ec-form-foot' },
          h('span', { className: 'ec-hint' }, pending ? t('nlSubmitting') : t('nlHint')),
          h(
            'button',
            { type: 'button', className: 'ec-btn ec-btn-primary', disabled: pending || empty, onClick: () => void submit() },
            pending ? t('nlSubmitting') : t('nlSubmit'),
          ),
        ),
        error ? h('p', { className: 'ec-form-error', role: 'alert' }, error) : null,
        notice
          ? h(
              'div',
              { className: 'ec-form-notice', role: 'status' },
              h('span', null, t('nlSuccess')),
              notice.sessionError
                ? h('span', { className: 'ec-hint ec-hint-warn' }, notice.sessionError)
                : notice.mode === 'draft'
                  ? h('span', { className: 'ec-hint' }, t('sessionDraftHint'))
                  : notice.sessionId
                    ? h('span', { className: 'ec-hint' }, t('sessionOpened', { id: notice.sessionId }))
                    : h('span', { className: 'ec-hint' }, t('sessionStarted')),
            )
          : null,
      )
    }

    /** Compact audit trail of catalog changes; hidden when there is nothing to show. */
    function RecentAdjustments(props) {
      const t = props.t
      const entries = Array.isArray(props.history) ? props.history.filter((entry) => entry && typeof entry === 'object') : []
      if (entries.length === 0) return null
      const sorted = entries.slice().sort((left, right) => timestampOf(right.at) - timestampOf(left.at))
      return h(
        'section',
        { className: 'ec-section' },
        h(SectionHeader, { title: t('historyTitle'), desc: t('historyDesc') }),
        h(
          'div',
          { className: 'ec-history' },
          sorted.slice(0, 12).map((entry, index) => {
            const actorLabel = entry.actor === 'agent' ? t('actorAgent') : t('actorUser')
            return h(
              'div',
              { key: `history-${nonEmpty(entry.id) ? entry.id : 'entry'}-${index}`, className: 'ec-history-row' },
              h(Chip, { dot: false, tone: entry.actor === 'agent' ? 'info' : 'muted', label: historyActionLabel(t, entry.action) }),
              h(
                'div',
                { className: 'ec-history-main' },
                h('p', { className: 'ec-history-summary' }, nonEmpty(entry.summary) ? entry.summary : t('unknown')),
                nonEmpty(entry.request)
                  ? h('p', { className: 'ec-history-request' }, t('historyRequest', { text: excerpt(entry.request, 160) }))
                  : null,
              ),
              h('span', { className: 'ec-actor' }, actorLabel),
              h('span', { className: 'ec-history-time' }, timestampOf(entry.at) ? dateTimeText(timestampOf(entry.at)) : t('unknown')),
            )
          }),
        ),
      )
    }

    function RecentConsults(props) {
      const t = props.t
      const lang = props.lang
      const consults = Array.isArray(props.consults) ? props.consults.filter((item) => item && typeof item === 'object') : []
      const teams = Array.isArray(props.teams) ? props.teams : []
      const domains = Array.isArray(props.domains) ? props.domains : []
      const teamNameFor = (teamId) => {
        const team = teams.find((item) => item && item.id === teamId)
        return team ? pickName(lang, team.name) || teamId : teamId
      }
      const domainFor = (domainId) => (nonEmpty(domainId) ? domains.find((item) => item && item.id === domainId) || null : null)
      return h(
        'section',
        { className: 'ec-section' },
        h(SectionHeader, { title: t('recentConsults'), count: consults.length, desc: t('consultsDesc') }),
        consults.length === 0
          ? h(EmptyGuide, { t })
          : h(
              'div',
              { className: 'ec-consult-list' },
              consults.slice(0, 20).map((consult) => {
                const domain = domainFor(consult.domainId)
                const intent = consult.intent === 'task' ? 'task' : 'review'
                const runStatus = nonEmpty(consult.runStatus) ? consult.runStatus : null
                const reportReady = runStatus === 'finished'
                const taskReady = intent === 'task' && consult.status === 'verdict'
                return h(
                  'button',
                  {
                    key: consult.id,
                    type: 'button',
                    className: 'ec-consult-row',
                    onClick: () => props.onOpen(consult.id),
                  },
                  h(StatusChip, { t, status: consult.status }),
                  h(
                    'span',
                    { className: 'ec-consult-main' },
                    h(
                      'span',
                      { className: 'ec-consult-chips' },
                      domain ? h(Chip, { dot: false, label: pickName(lang, domain.name) || domain.id }) : null,
                      h(IntentChip, { t, intent }),
                      runStatus ? h(RunStatusChip, { t, status: runStatus }) : null,
                      h('span', { className: 'ec-consult-team' }, teamNameFor(consult.teamId)),
                    ),
                    h('span', { className: 'ec-consult-question' }, excerpt(consult.question, 140) || t('unknown')),
                    h(
                      'span',
                      { className: 'ec-consult-decision' },
                      nonEmpty(consult.decision)
                        ? intent === 'task'
                          ? excerpt(consult.decision, 140)
                          : `${t('decisionLabel')}: ${excerpt(consult.decision, 120)}`
                        : intent === 'task'
                          ? t('taskPendingShort')
                          : t('noDecision'),
                    ),
                  ),
                  h(
                    'span',
                    { className: 'ec-consult-meta' },
                    `${t('roundsCount', { count: finite(consult.roundCount) ? consult.roundCount : 0 })} · ${formatNumber(consult.tokens)} ${t('tokenUnit')}`,
                    taskReady ? h('span', { className: 'ec-consult-report ec-consult-taskmark' }, t('taskMarker')) : null,
                    reportReady ? h('span', { className: 'ec-consult-report' }, t('reportMarker')) : null,
                  ),
                  h('span', { className: 'ec-consult-time' }, timestampOf(consult.updatedAt || consult.createdAt) ? dateTimeText(timestampOf(consult.updatedAt || consult.createdAt)) : t('unknown')),
                )
              }),
            ),
      )
    }

    /* ------------------------------------------------------------------ */
    /* Team detail: protocol, lenses, agenda, convene form.                 */
    /* ------------------------------------------------------------------ */

    function RulesSection(props) {
      const t = props.t
      const rules = props.protocol && Array.isArray(props.protocol.rules) ? props.protocol.rules : []
      if (rules.length === 0) return null
      return h(
        'details',
        { className: 'ec-rules' },
        h(
          'summary',
          null,
          h(Chip, { dot: false, label: t('protocol') }),
          h('span', { className: 'ec-section-aside' }, t('protocolCount', { count: rules.length })),
        ),
        h(
          'ol',
          { className: 'ec-rules-list' },
          rules.map((rule, index) =>
            h(
              'li',
              { key: nonEmpty(rule.id) ? rule.id : `rule-${index}`, className: 'ec-rule' },
              h('span', { className: 'ec-rule-title' }, nonEmpty(rule.title) ? rule.title : t('unknown')),
              h('span', { className: 'ec-rule-text' }, nonEmpty(rule.text) ? rule.text : ''),
            ),
          ),
        ),
      )
    }

    function ExpertLensCard(props) {
      const t = props.t
      const lang = props.lang
      const member = props.member
      const expert = props.expert
      const name = pickName(lang, (expert && expert.name) || member.name) || member.id
      const mandate = (expert && expert.mandate) || member.mandate || ''
      const asks = expert && Array.isArray(expert.asks) ? expert.asks.filter(nonEmpty) : []
      const redLines = expert && Array.isArray(expert.redLines) ? expert.redLines.filter(nonEmpty) : []
      const budget = expert && expert.budget && typeof expert.budget === 'object' ? expert.budget : null
      return h(
        'article',
        { className: 'ec-lens' },
        h(
          'div',
          { className: 'ec-lens-head' },
          h('h3', { className: 'ec-lens-name' }, name),
          member.role === 'lead' ? h(Chip, { tone: 'info', label: t('roleLead') }) : null,
        ),
        nonEmpty(mandate)
          ? h(
              'div',
              { className: 'ec-lens-block' },
              h('span', { className: 'ec-lens-label' }, t('mandateLabel')),
              h('p', { className: 'ec-lens-mandate' }, mandate),
            )
          : null,
        expert && nonEmpty(expert.lens)
          ? h('p', { className: 'ec-lens-line' }, h('span', { className: 'ec-lens-label' }, t('lensLabel')), expert.lens)
          : null,
        asks.length > 0
          ? h(
              'div',
              { className: 'ec-lens-block' },
              h('span', { className: 'ec-lens-label' }, t('asksLabel')),
              h('ol', { className: 'ec-ordered' }, asks.map((ask, index) => h('li', { key: `ask-${index}` }, ask))),
            )
          : null,
        redLines.length > 0
          ? h(
              'div',
              { className: 'ec-lens-block' },
              h('span', { className: 'ec-lens-label' }, t('redLinesLabel')),
              h('div', { className: 'ec-chips' }, redLines.map((line, index) => h('span', { key: `red-${index}`, className: 'ec-chip' }, line))),
            )
          : null,
        expert && nonEmpty(expert.misses)
          ? h('p', { className: 'ec-lens-line' }, h('span', { className: 'ec-lens-label' }, t('missesLabel')), expert.misses)
          : null,
        budget
          ? h(
              'p',
              { className: 'ec-lens-line ec-mono' },
              `${t('budgetLabel')} ${finite(budget.standard) ? formatNumber(budget.standard) : t('unknown')} / ${finite(budget.deep) ? formatNumber(budget.deep) : t('unknown')} ${t('tokenUnit')}`,
            )
          : null,
      )
    }

    function LensesSection(props) {
      const t = props.t
      const lang = props.lang
      const team = props.team
      const experts = Array.isArray(props.experts) ? props.experts : []
      const members = Array.isArray(team.members) ? team.members : []
      if (members.length === 0) return null
      return h(
        Section,
        { index: '02', title: t('expertLenses'), aside: String(members.length) },
        h(
          'div',
          { className: 'ec-lens-grid' },
          members.map((member) => {
            const expert = experts.find((item) => item && item.id === member.id) || null
            return h(ExpertLensCard, { key: member.id || pickName(lang, member.name), t, lang, member, expert })
          }),
        ),
      )
    }

    function AgendaArtifacts(props) {
      const t = props.t
      const team = props.team
      const agenda = Array.isArray(team.agenda) ? team.agenda.filter(nonEmpty) : []
      const artifacts = Array.isArray(team.artifacts) ? team.artifacts.filter(nonEmpty) : []
      if (agenda.length === 0 && artifacts.length === 0) return null
      return h(
        Section,
        { index: '03', title: `${t('agendaLabel')} / ${t('artifactsLabel')}` },
        h(
          'div',
          { className: 'ec-two-col' },
          h(
            'div',
            { className: 'ec-block' },
            h('h3', { className: 'ec-block-title' }, t('agendaLabel')),
            agenda.length > 0
              ? h('ol', { className: 'ec-ordered' }, agenda.map((item, index) => h('li', { key: `agenda-${index}` }, item)))
              : h('p', { className: 'ec-empty-inline' }, t('unknown')),
          ),
          h(
            'div',
            { className: 'ec-block' },
            h('h3', { className: 'ec-block-title' }, t('artifactsLabel')),
            artifacts.length > 0
              ? h('ul', { className: 'ec-bullets' }, artifacts.map((item, index) => h('li', { key: `artifact-${index}` }, item)))
              : h('p', { className: 'ec-empty-inline' }, t('unknown')),
          ),
        ),
      )
    }

    function ConveneForm(props) {
      const t = props.t
      const team = props.team
      const estimates = team && team.estimates && typeof team.estimates === 'object' ? team.estimates : null
      const defaultMode = MODE_VALUES.includes(team && team.defaultMode) ? team.defaultMode : 'standard'
      const minChars = finite(props.questionMin) ? Math.max(1, Math.trunc(props.questionMin)) : QUESTION_MIN
      const [question, setQuestion] = React.useState('')
      const [context, setContext] = React.useState('')
      const [mode, setMode] = React.useState(defaultMode)
      const [intent, setIntent] = React.useState(defaultIntent(props.protocol))
      const [cap, setCap] = React.useState('')
      const [pending, setPending] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [notice, setNotice] = React.useState(null)
      const busyRef = React.useRef(false)
      const estimateCap = estimates && finite(estimates[mode]) ? estimates[mode] : null
      const questionLength = question.trim().length

      React.useEffect(() => {
        if (props.focusConvene !== true) return
        try {
          if (typeof document === 'undefined') return
          const form = document.getElementById('ec-convene')
          if (form && typeof form.scrollIntoView === 'function') {
            form.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
          }
          const field = document.getElementById('ec-question')
          if (field && typeof field.focus === 'function') field.focus()
        } catch (error) {
          // Focusing is cosmetic; never fail the form on it.
        }
      }, [props.focusConvene])

      const submit = async () => {
        if (busyRef.current) return
        const text = question.trim()
        if (text.length < minChars) {
          setError(t('questionTooShort', { min: minChars }))
          return
        }
        let budgetCap = null
        if (cap.trim().length > 0) {
          const numeric = Number(cap.trim())
          if (!finite(numeric) || numeric < BUDGET_MIN || numeric > BUDGET_MAX) {
            setError(t('budgetCapInvalid'))
            return
          }
          budgetCap = Math.trunc(numeric)
        }
        busyRef.current = true
        setPending(true)
        setError(null)
        setNotice(null)
        try {
          const outcome = await props.onConvene({
            question: text,
            context: context.trim(),
            mode,
            intent,
            budgetCap,
          })
          setQuestion('')
          setContext('')
          setCap('')
          setNotice(outcome)
        } catch (failure) {
          setError(t('conveneFailed', { message: describeError(t, failure) }))
        } finally {
          busyRef.current = false
          setPending(false)
        }
      }

      const onQuestionKeyDown = (event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          void submit()
        }
      }

      return h(
        'section',
        { className: 'ec-form', id: 'ec-convene' },
        h('h2', { className: 'ec-form-title' }, t('conveneTitle')),
        h(
          'div',
          { className: 'ec-form-row' },
          h('label', { className: 'ec-label', htmlFor: 'ec-question' }, t('questionLabel')),
          h('textarea', {
            id: 'ec-question',
            className: 'ec-textarea',
            rows: 3,
            value: question,
            spellCheck: false,
            placeholder: t('questionPlaceholder'),
            onChange: (event) => setQuestion(event.target.value),
            onKeyDown: onQuestionKeyDown,
          }),
          h(
            'p',
            { className: `ec-hint${questionLength > 0 && questionLength < minChars ? ' ec-hint-warn' : ''}` },
            t('questionMeta', { count: questionLength, min: minChars }),
          ),
        ),
        h(
          'div',
          { className: 'ec-form-row' },
          h('label', { className: 'ec-label', htmlFor: 'ec-context' }, t('contextLabel')),
          h('textarea', {
            id: 'ec-context',
            className: 'ec-textarea',
            rows: 2,
            value: context,
            spellCheck: false,
            placeholder: t('contextPlaceholder'),
            onChange: (event) => setContext(event.target.value),
          }),
        ),
        h(
          'div',
          { className: 'ec-form-row' },
          h('label', { className: 'ec-label', htmlFor: 'ec-intent' }, t('intentLabel')),
          h(
            'select',
            { id: 'ec-intent', className: 'ec-select', value: intent, onChange: (event) => setIntent(event.target.value) },
            intentOptions(t, props.protocol).map((option) => h('option', { key: option.id, value: option.id }, option.label)),
          ),
          h('p', { className: 'ec-hint' }, intent === 'task' ? t('intentTaskWhen') : t('intentReviewWhen')),
          intent === 'task' ? h('p', { className: 'ec-hint' }, t('taskBudgetHint')) : null,
        ),
        h(
          'div',
          { className: 'ec-form-grid' },
          h(
            'div',
            { className: 'ec-form-row' },
            h('label', { className: 'ec-label', htmlFor: 'ec-mode' }, t('modeFieldLabel')),
            h(
              'select',
              { id: 'ec-mode', className: 'ec-select', value: mode, onChange: (event) => setMode(event.target.value) },
              MODE_VALUES.map((value) => h('option', { key: value, value }, dictLabel(t, MODE_KEYS, value, 'unknown'))),
            ),
            h(
              'p',
              { className: 'ec-hint' },
              `${t('estimateHint', { cap: estimateCap === null ? t('unknown') : formatNumber(estimateCap) })} · ${dictLabel(t, MODE_WHEN_KEYS, mode, 'unknown')}`,
            ),
          ),
          h(
            'div',
            { className: 'ec-form-row' },
            h('label', { className: 'ec-label', htmlFor: 'ec-budget' }, t('budgetCapLabel')),
            h('input', {
              id: 'ec-budget',
              className: 'ec-input',
              type: 'text',
              inputMode: 'numeric',
              value: cap,
              placeholder: t('budgetCapPlaceholder', { cap: estimateCap === null ? t('unknown') : formatNumber(estimateCap) }),
              onChange: (event) => setCap(event.target.value),
            }),
            h('p', { className: 'ec-hint' }, t('budgetCapHint')),
          ),
        ),
        h(
          'div',
          { className: 'ec-form-foot' },
          h(
            'button',
            { type: 'button', className: 'ec-btn ec-btn-primary', disabled: pending, onClick: () => void submit() },
            pending ? t('convening') : t('submitConvene'),
          ),
        ),
        error ? h('p', { className: 'ec-form-error', role: 'alert' }, error) : null,
        notice
          ? h(
              'div',
              { className: 'ec-form-notice', role: 'status' },
              h('span', null, t('conveneSuccess', { id: notice.consultId })),
              notice.sessionError
                ? h('span', { className: 'ec-hint ec-hint-warn' }, notice.sessionError)
                : notice.mode === 'draft'
                  ? h('span', { className: 'ec-hint' }, t('sessionDraftHint'))
                  : notice.sessionId
                    ? h('span', { className: 'ec-hint' }, t('sessionOpened', { id: notice.sessionId }))
                    : h('span', { className: 'ec-hint' }, t('sessionStarted')),
            )
          : null,
      )
    }

    function TeamDetail(props) {
      const t = props.t
      const lang = props.lang
      const team = props.team
      const [confirmDelete, setConfirmDelete] = React.useState(false)
      const [pending, setPending] = React.useState(false)
      const [error, setError] = React.useState(null)
      const busyRef = React.useRef(false)
      if (!team) return null
      const incomplete = team.incomplete === true

      const runDelete = async () => {
        if (busyRef.current) return
        busyRef.current = true
        setPending(true)
        setError(null)
        try {
          await props.onDelete(team)
        } catch (failure) {
          setError(t('deleteFailed', { message: describeError(t, failure) }))
        } finally {
          busyRef.current = false
          setPending(false)
        }
      }

      return h(
        'div',
        { className: 'ec-detail' },
        h(
          'div',
          { className: 'ec-detail-head' },
          h(BackButton, { t, onClick: props.onBack }),
          h('h1', { className: 'ec-detail-title' }, pickName(lang, team.name)),
          h(
            'div',
            { className: 'ec-detail-meta' },
            h(ModeChip, { t, mode: team.defaultMode }),
            h('span', { className: 'ec-mono' }, team.id),
            h(EntityBadges, { t, entity: team }),
            incomplete ? h(Chip, { tone: 'blocked', label: t('incompleteTeam') }) : null,
            h('span', { className: 'ec-esc' }, t('escHint')),
          ),
          h(
            'div',
            { className: 'ec-detail-actions' },
            h('button', { type: 'button', className: 'ec-btn ec-btn-sm', onClick: props.onEdit }, t('editTeam')),
            h(
              'button',
              { type: 'button', className: 'ec-btn ec-btn-sm ec-btn-danger', onClick: () => setConfirmDelete(true) },
              t('remove'),
            ),
          ),
          nonEmpty(team.tagline) ? h('p', { className: 'ec-team-tagline' }, team.tagline) : null,
          h(
            'div',
            { className: 'ec-field-grid' },
            h('span', { className: 'ec-field-label' }, t('teamIntent')),
            h('span', { className: 'ec-field-value' }, nonEmpty(team.intent) ? team.intent : t('unknown')),
            h('span', { className: 'ec-field-label' }, t('membersLabel')),
            h('span', { className: 'ec-field-value' }, String(Array.isArray(team.members) ? team.members.length : 0)),
            h('span', { className: 'ec-field-label' }, t('defaultMode')),
            h('span', { className: 'ec-field-value' }, h(ModeChip, { t, mode: team.defaultMode })),
          ),
        ),
        confirmDelete
          ? h(ConfirmRow, {
              t,
              message: team.preset === true ? t('deletePresetTeam') : t('deleteCustomTeam'),
              confirmLabel: t('confirmDelete'),
              pending,
              error,
              onCancel: () => {
                setConfirmDelete(false)
                setError(null)
              },
              onConfirm: () => {
                void runDelete()
              },
            })
          : null,
        error && !confirmDelete ? h('p', { className: 'ec-form-error', role: 'alert' }, error) : null,
        incomplete ? h('p', { className: 'ec-hint ec-hint-warn' }, t('incompleteTeamHint')) : null,
        h(RulesSection, { t, protocol: props.protocol }),
        h(LensesSection, { t, lang, team, experts: props.experts }),
        h(AgendaArtifacts, { t, team }),
        incomplete
          ? null
          : h(ConveneForm, {
              t,
              team,
              protocol: props.protocol,
              focusConvene: props.focusConvene,
              questionMin: props.questionMin,
              onConvene: props.onConvene,
            }),
      )
    }

    /* ------------------------------------------------------------------ */
    /* Consult detail: question, verdict, disagreements, rounds, archive.  */
    /* ------------------------------------------------------------------ */

    function ConsultDetail(props) {
      const t = props.t
      const lang = props.lang
      const state = useConsultDetail(props.id, props.revision)
      const consult = state.consult
      const team = state.team || props.team || null
      const domain = state.domain || props.domain || null
      const reportAvailable = state.reportAvailable === true || props.reportAvailable === true
      const runSnapshot = props.runSnapshot && typeof props.runSnapshot === 'object' ? props.runSnapshot : null
      const [pending, setPending] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [notice, setNotice] = React.useState(null)
      const [runPending, setRunPending] = React.useState(null)
      const [runError, setRunError] = React.useState(null)
      const [reportOpen, setReportOpen] = React.useState(false)
      const [reportLoading, setReportLoading] = React.useState(false)
      const [reportError, setReportError] = React.useState(null)
      const [reportText, setReportText] = React.useState('')
      const busyRef = React.useRef(false)
      const onArchive = props.onArchive
      const onBack = props.onBack
      const onRefresh = props.onRefresh

      React.useEffect(() => {
        busyRef.current = false
        setPending(false)
        setError(null)
        setNotice(null)
        setRunPending(null)
        setRunError(null)
        setReportOpen(false)
        setReportLoading(false)
        setReportError(null)
        setReportText('')
      }, [props.id])

      const archive = async () => {
        if (busyRef.current) return
        busyRef.current = true
        setPending(true)
        setError(null)
        setNotice(null)
        try {
          await onArchive(consult.id)
          setNotice(t('archiveDone'))
        } catch (failure) {
          setError(t('archiveFailed', { message: describeError(t, failure) }))
        } finally {
          busyRef.current = false
          setPending(false)
        }
      }

      const startRealRun = async () => {
        if (busyRef.current || !props.onStartRun) return
        busyRef.current = true
        setRunPending('start')
        setRunError(null)
        try {
          await props.onStartRun(props.id)
          if (onRefresh) await onRefresh()
        } catch (failure) {
          setRunError(t('launchError', { message: describeError(t, failure) }))
        } finally {
          busyRef.current = false
          setRunPending(null)
        }
      }

      const cancelRealRun = async () => {
        if (busyRef.current || !props.onCancelRun) return
        busyRef.current = true
        setRunPending('cancel')
        setRunError(null)
        try {
          await props.onCancelRun(props.id)
          setNotice(t('cancelRunDone'))
          if (onRefresh) await onRefresh()
        } catch (failure) {
          setRunError(t('cancelRunFailed', { message: describeError(t, failure) }))
        } finally {
          busyRef.current = false
          setRunPending(null)
        }
      }

      const requireReportText = async () => {
        if (nonEmpty(reportText)) return reportText
        const text = await apiGetText(API_REPORT, { id: props.id })
        setReportText(text)
        return text
      }

      const openReport = async () => {
        setReportOpen(true)
        setReportError(null)
        if (nonEmpty(reportText)) return
        setReportLoading(true)
        try {
          await requireReportText()
        } catch (failure) {
          setReportError(describeError(t, failure))
        } finally {
          setReportLoading(false)
        }
      }

      const downloadReport = async () => {
        try {
          const text = await requireReportText()
          downloadMarkdown(`${props.id}-report.md`, text)
        } catch (failure) {
          setReportError(describeError(t, failure))
          setReportOpen(true)
        }
      }

      const headConsult = consult || null
      const question = headConsult ? headConsult.question : ''
      const context = headConsult ? headConsult.context : ''
      const budget = headConsult && headConsult.budget && typeof headConsult.budget === 'object' ? headConsult.budget : null
      const verdict = headConsult && headConsult.verdict && typeof headConsult.verdict === 'object' ? headConsult.verdict : null
      const disagreements = headConsult && Array.isArray(headConsult.disagreements) ? headConsult.disagreements : []
      const rounds = headConsult && Array.isArray(headConsult.rounds) ? headConsult.rounds : []
      const run = headConsult && headConsult.run && typeof headConsult.run === 'object' ? headConsult.run : null
      const runRunning = Boolean(run && run.status === 'running')
      const intent =
        headConsult && headConsult.intent === 'task' ? 'task' : run && run.intent === 'task' ? 'task' : 'review'
      const isTask = intent === 'task'
      const domainArtifacts = domain && Array.isArray(domain.artifacts) ? domain.artifacts.filter(nonEmpty) : []
      const artifactNotes = verdict && Array.isArray(verdict.artifactNotes) ? verdict.artifactNotes.filter(nonEmpty) : []
      const artifactsBlock =
        !isTask && verdict && domainArtifacts.length > 0
          ? h(
              'div',
              { className: 'ec-block' },
              h('span', { className: 'ec-lens-label' }, t('artifactsLabel')),
              h(
                'ul',
                { className: 'ec-artifacts' },
                domainArtifacts.map((item, index) =>
                  h(
                    'li',
                    { key: `artifact-${index}`, className: 'ec-artifact ec-artifact-on' },
                    h('span', { className: 'ec-artifact-box' }, '✓'),
                    h('span', null, item),
                    h('span', { className: 'ec-artifact-status' }, t('artifactDelivered')),
                  ),
                ),
              ),
              artifactNotes.length > 0
                ? h(
                    'div',
                    { className: 'ec-block' },
                    h('span', { className: 'ec-lens-label' }, t('artifactNotes')),
                    h('ul', { className: 'ec-bullets' }, artifactNotes.map((item, index) => h('li', { key: `artifact-note-${index}` }, item))),
                  )
                : null,
            )
          : null
      const reportButtons = h(
        'div',
        { className: 'ec-report-bar' },
        h(
          'button',
          {
            type: 'button',
            className: `ec-btn ec-btn-sm${isTask ? ' ec-btn-primary' : ''}`,
            onClick: () => void openReport(),
          },
          isTask ? t('taskReportView') : t('reportView'),
        ),
        h('button', { type: 'button', className: 'ec-btn ec-btn-sm', onClick: () => void downloadReport() }, t('reportDownload')),
      )
      const reportBar = !isTask && reportAvailable && verdict ? reportButtons : null
      const taskReportBar =
        isTask && reportAvailable && verdict
          ? h('div', { className: 'ec-report-cta' }, h('p', { className: 'ec-hint' }, t('taskReportNote')), reportButtons)
          : null
      const runBody = headConsult
        ? h(
            'div',
            { className: 'ec-run' },
            run || runSnapshot
              ? h(RunTimeline, { t, mode: headConsult.mode, intent, run, snapshot: runSnapshot })
              : h('p', { className: 'ec-empty-inline' }, isTask ? t('taskRunIdleHint') : t('runIdleHint')),
            h(
              'div',
              { className: 'ec-report-bar' },
              headConsult.status === 'open' && !run && !props.runtimeUnavailable
                ? h(
                    'button',
                    { type: 'button', className: 'ec-btn ec-btn-primary ec-btn-sm', disabled: runPending !== null, onClick: () => void startRealRun() },
                    runPending === 'start' ? t('working') : t('launchRun'),
                  )
                : null,
              runRunning
                ? h(
                    'button',
                    { type: 'button', className: 'ec-btn ec-btn-danger ec-btn-sm', disabled: runPending !== null, onClick: () => void cancelRealRun() },
                    runPending === 'cancel' ? t('canceling') : t('cancelRun'),
                  )
                : null,
              headConsult.status === 'open' && !run && props.runtimeUnavailable
                ? h('span', { className: 'ec-hint ec-hint-warn' }, t('launchRunUnavailable'))
                : null,
            ),
            runError ? h('p', { className: 'ec-form-error', role: 'alert' }, runError) : null,
            h('span', { className: 'ec-lens-label' }, t('runExpertsTitle')),
            h(RunExpertTable, { t, lang, team, run, snapshot: runSnapshot, rounds }),
          )
        : null

      let pendingBody = null
      if (!headConsult) {
        if (state.error) {
          pendingBody = h(ErrorBar, {
            message: t('detailError', { message: describeError(t, state.error) }),
            retryLabel: t('retry'),
            onRetry: () => props.onRetry(),
          })
        } else if (state.loading) {
          pendingBody = h('div', { className: 'ec-state' }, t('detailLoading'))
        } else {
          pendingBody = h(EmptyState, { t, showGlyph: false, title: t('consultNotFound'), hint: t('consultMissingHint') })
        }
      }

      const reviewVerdictBody = verdict
        ? h(
            React.Fragment,
            null,
            h(
              'div',
              { className: 'ec-verdict-grid' },
              h('span', { className: 'ec-field-label' }, t('verdictDecision')),
              h('p', { className: 'ec-verdict-decision' }, nonEmpty(verdict.decision) ? verdict.decision : t('unknown')),
              h('span', { className: 'ec-field-label' }, t('verdictConfidence')),
              h('span', { className: 'ec-field-value ec-mono' }, percentText(t, verdict.confidence)),
            ),
            nonEmpty(verdict.rationale)
              ? h(
                  'div',
                  { className: 'ec-block' },
                  h('span', { className: 'ec-lens-label' }, t('verdictRationale')),
                  h('p', { className: 'ec-raw' }, verdict.rationale),
                )
              : null,
            h(
              'div',
              { className: 'ec-block' },
              h('span', { className: 'ec-lens-label' }, t('verdictDissent')),
              Array.isArray(verdict.dissent) && verdict.dissent.length > 0
                ? h(
                    'div',
                    { className: 'ec-chips' },
                    verdict.dissent.map((item, index) => h('div', { key: `dissent-${index}`, className: 'ec-dissent' },
                      h(
                        'div',
                        { className: 'ec-dissent-head' },
                        h('span', { className: 'ec-dissent-expert' }, memberName(lang, team, item.expert) || t('unknownExpert')),
                      ),
                      h('p', { className: 'ec-dissent-point' }, nonEmpty(item.point) ? item.point : t('unknown')),
                      nonEmpty(item.evidence) ? h('p', { className: 'ec-dissent-evidence' }, item.evidence) : null,
                    )),
                  )
                : h('p', { className: 'ec-empty-inline' }, t('dissentEmpty')),
            ),
            Array.isArray(verdict.unresolved) && verdict.unresolved.length > 0
              ? h(
                  'div',
                  { className: 'ec-block' },
                  h('span', { className: 'ec-lens-label' }, t('verdictUnresolved')),
                  h('ul', { className: 'ec-bullets' }, verdict.unresolved.map((item, index) => h('li', { key: `unresolved-${index}` }, item))),
                )
              : null,
            Array.isArray(verdict.reversalTriggers) && verdict.reversalTriggers.length > 0
              ? h(
                  'div',
                  { className: 'ec-block' },
                  h('span', { className: 'ec-lens-label' }, t('verdictReversal')),
                  h('ul', { className: 'ec-bullets' }, verdict.reversalTriggers.map((item, index) => h('li', { key: `reversal-${index}` }, item))),
                )
              : null,
            Array.isArray(verdict.actions) && verdict.actions.length > 0
              ? h(
                  'div',
                  { className: 'ec-block' },
                  h('span', { className: 'ec-lens-label' }, t('verdictActions')),
                  h('ul', { className: 'ec-bullets' }, verdict.actions.map((item, index) => h('li', { key: `action-${index}` }, item))),
                )
              : null,
            artifactsBlock,
            reportBar,
          )
        : h('p', { className: 'ec-empty-inline' }, t('noVerdict'))

      const taskResultBody =
        verdict && isTask
          ? h(
              'div',
              { className: 'ec-task-result' },
              h('h3', { className: 'ec-task-title' }, nonEmpty(verdict.decision) ? verdict.decision : t('taskResultTitle')),
              nonEmpty(verdict.rationale)
                ? h(
                    'div',
                    { className: 'ec-block' },
                    h('span', { className: 'ec-lens-label' }, t('taskSummary')),
                    h('p', { className: 'ec-raw' }, verdict.rationale),
                  )
                : null,
              Array.isArray(verdict.actions) && verdict.actions.length > 0
                ? h(
                    'div',
                    { className: 'ec-block' },
                    h('span', { className: 'ec-lens-label' }, t('taskNextActions')),
                    h('ul', { className: 'ec-bullets' }, verdict.actions.map((item, index) => h('li', { key: `task-action-${index}` }, item))),
                  )
                : null,
              h(
                'div',
                { className: 'ec-block' },
                h('span', { className: 'ec-lens-label' }, t('taskDeliverables')),
                artifactNotes.length > 0
                  ? h(
                      'ul',
                      { className: 'ec-artifacts' },
                      artifactNotes.map((item, index) =>
                        h(
                          'li',
                          { key: `task-artifact-${index}`, className: 'ec-artifact ec-artifact-on' },
                          h('span', { className: 'ec-artifact-box' }, '✓'),
                          h('span', null, item),
                        ),
                      ),
                    )
                  : h('p', { className: 'ec-empty-inline' }, t('taskDeliverablesEmpty')),
              ),
              h('p', { className: 'ec-hint' }, t('taskNoReview')),
              taskReportBar,
            )
          : null
      const verdictBody = isTask
        ? verdict
          ? taskResultBody
          : h('p', { className: 'ec-empty-inline' }, t('taskNoResult'))
        : reviewVerdictBody

      const disagreementsBody =
        disagreements.length === 0
          ? h('p', { className: 'ec-empty-inline' }, t('disagreementsEmpty'))
          : h(
              React.Fragment,
              null,
              disagreements.map((item, index) => {
                const left = memberName(lang, team, item.a) || t('unknownExpert')
                const right = memberName(lang, team, item.b) || t('unknownExpert')
                return h(
                  'div',
                  { key: `disagreement-${index}`, className: 'ec-disagreement' },
                  h('span', { className: 'ec-disagreement-pair' }, t('pairComparison', { left, right })),
                  h(Chip, {
                    dot: false,
                    tone: item.kind === 'confidence' ? 'waiting' : 'blocked',
                    label: dictLabel(t, DISAGREEMENT_KIND_KEYS, item.kind, 'unknown'),
                  }),
                  nonEmpty(item.reason) ? h('p', { className: 'ec-disagreement-reason' }, item.reason) : null,
                )
              }),
            )

      const roundsBody =
        rounds.length === 0
          ? h('p', { className: 'ec-empty-inline' }, t('roundsEmpty'))
          : h(
              React.Fragment,
              null,
              rounds.map((round, roundIndex) => {
                const opinions = Array.isArray(round.opinions) ? round.opinions : []
                return h(
                  'details',
                  { key: `round-${roundIndex}`, className: 'ec-round' },
                  h(
                    'summary',
                    null,
                    h('span', null, t('roundLabel', { round: finite(round.round) ? round.round : roundIndex + 1 })),
                    h('span', { className: 'ec-mono' }, t('roundTokens', { tokens: formatNumber(round.tokens) })),
                    h('span', { className: 'ec-mono' }, t('opinionsCount', { count: opinions.length })),
                  ),
                  h(
                    'div',
                    { className: 'ec-round-body' },
                    opinions.length === 0
                      ? h('p', { className: 'ec-empty-inline' }, t('roundsEmpty'))
                      : opinions.map((opinion, opinionIndex) => {
                          const claims = Array.isArray(opinion.claims) ? opinion.claims : []
                          const unknowns = Array.isArray(opinion.unknowns) ? opinion.unknowns.filter(nonEmpty) : []
                          return h(
                            'div',
                            { key: `opinion-${opinionIndex}`, className: 'ec-opinion' },
                            h(
                              'div',
                              { className: 'ec-opinion-head' },
                              h('span', { className: 'ec-opinion-expert' }, memberName(lang, team, opinion.expert) || t('unknownExpert')),
                              h(StanceChip, { t, stance: opinion.stance }),
                              h('span', { className: 'ec-opinion-conf', title: t('verdictConfidence') }, percentText(t, opinion.confidence)),
                            ),
                            claims.length > 0
                              ? h(
                                  'div',
                                  { className: 'ec-block' },
                                  h('span', { className: 'ec-lens-label' }, t('claimsLabel')),
                                  claims.map((claim, claimIndex) =>
                                    h(
                                      'p',
                                      { key: `claim-${claimIndex}`, className: 'ec-claim' },
                                      h('span', { className: 'ec-claim-text' }, nonEmpty(claim.claim) ? claim.claim : t('unknown')),
                                      nonEmpty(claim.evidence) ? h('span', { className: 'ec-claim-evidence' }, `${t('claimEvidence')}: ${claim.evidence}`) : null,
                                    ),
                                  ),
                                )
                              : null,
                            nonEmpty(opinion.changes)
                              ? h('p', { className: 'ec-lens-line' }, h('span', { className: 'ec-lens-label' }, t('changesLabel')), opinion.changes)
                              : null,
                            unknowns.length > 0
                              ? h(
                                  'div',
                                  { className: 'ec-block' },
                                  h('span', { className: 'ec-lens-label' }, t('unknownsLabel')),
                                  h('div', { className: 'ec-chips' }, unknowns.map((item, index) => h('span', { key: `unknown-${index}`, className: 'ec-chip' }, item))),
                                )
                              : null,
                          )
                        }),
                  ),
                )
              }),
            )

      return h(
        'div',
        { className: 'ec-detail' },
        h(
          'div',
          { className: 'ec-detail-head' },
          h(BackButton, { t, onClick: onBack }),
          h('h1', { className: 'ec-detail-title' }, team ? pickName(lang, team.name) : t('unknown')),
          h(
            'div',
            { className: 'ec-detail-meta' },
            headConsult ? h(StatusChip, { t, status: headConsult.status }) : null,
            headConsult ? h(ModeChip, { t, mode: headConsult.mode }) : null,
            headConsult ? h(IntentChip, { t, intent }) : null,
            domain
              ? h(Chip, { dot: false, tone: 'info', label: t('domainLabel'), value: pickName(lang, domain.name) || domain.id })
              : null,
            run && nonEmpty(run.status) ? h(RunStatusChip, { t, status: run.status }) : null,
            h('span', { className: 'ec-mono', title: props.id }, props.id),
            headConsult && finite(headConsult.createdAt)
              ? h('span', { className: 'ec-mono' }, t('createdAt', { time: dateTimeText(headConsult.createdAt) }))
              : null,
            h('span', { className: 'ec-esc' }, t('escHint')),
          ),
          headConsult && budget
            ? h('p', { className: 'ec-hint' }, t('budgetLine', {
                tokens: formatNumber(headConsult.tokens),
                cap: finite(budget.cap) ? formatNumber(budget.cap) : t('unknown'),
              }))
            : null,
        ),
        pendingBody,
        headConsult
          ? h(
              React.Fragment,
              null,
              h(
                Section,
                { index: '01', title: t('sectionQuestion') },
                h('p', { className: 'ec-raw' }, nonEmpty(question) ? question : t('unknown')),
                nonEmpty(context) ? h('p', { className: 'ec-context' }, context) : h('p', { className: 'ec-empty-inline' }, t('contextEmpty')),
              ),
              h(Section, { index: '02', title: t('runTitle') }, runBody),
              h(Section, { index: '03', title: isTask ? t('taskResultTitle') : t('sectionVerdict') }, verdictBody),
              isTask ? null : h(Section, { index: '04', title: t('sectionDisagreements'), aside: String(disagreements.length) }, disagreementsBody),
              isTask ? null : h(Section, { index: '05', title: t('sectionRounds'), aside: String(rounds.length) }, roundsBody),
              headConsult.status !== 'archived'
                ? h(
                    'div',
                    { className: 'ec-actionbar' },
                    h(
                      'div',
                      { className: 'ec-actionbar-row' },
                      h(
                        'button',
                        { type: 'button', className: 'ec-btn ec-btn-danger', disabled: pending, onClick: () => void archive() },
                        pending ? t('archiving') : t('archive'),
                      ),
                    ),
                    notice ? h('p', { className: 'ec-form-notice', role: 'status' }, notice) : null,
                    error ? h('p', { className: 'ec-form-error', role: 'alert' }, error) : null,
                  )
                : h('p', { className: 'ec-empty-inline' }, t('archiveDone')),
            )
          : null,
        reportOpen
          ? h(ReportModal, {
              t,
              title: isTask ? t('taskReportTitle') : t('reportTitle'),
              text: reportText,
              loading: reportLoading,
              error: reportError,
              onClose: () => setReportOpen(false),
              onDownload: () => {
                void downloadReport()
              },
            })
          : null,
      )
    }

    /* ------------------------------------------------------------------ */
    /* Master panel.                                                        */
    /* ------------------------------------------------------------------ */

    function CouncilPanel(props) {
      const sourceT = props.sourceT
      const ctx = props.ctx
      const t = React.useMemo(() => createTranslator(sourceT), [sourceT])
      const lang = React.useMemo(() => (t('lang') === 'zh' ? 'zh' : 'en'), [t])
      const council = useCouncilState()
      const payload = council.data && typeof council.data === 'object' ? council.data : null
      const teams = React.useMemo(() => (payload && Array.isArray(payload.teams) ? payload.teams.filter((team) => team && typeof team === 'object') : []), [payload])
      const experts = React.useMemo(() => (payload && Array.isArray(payload.experts) ? payload.experts.filter((expert) => expert && typeof expert === 'object') : []), [payload])
      const domains = React.useMemo(() => (payload && Array.isArray(payload.domains) ? payload.domains.filter((domain) => domain && typeof domain === 'object') : []), [payload])
      const runtime = payload && payload.runtime && typeof payload.runtime === 'object' ? payload.runtime : null
      const runtimeAvailable = !runtime || runtime.llmAvailable !== false
      const activeRuns = runtime && Array.isArray(runtime.activeRuns) ? runtime.activeRuns.filter((item) => item && typeof item === 'object') : []
      const protocol = payload && payload.protocol && typeof payload.protocol === 'object' ? payload.protocol : null
      const consults = payload && Array.isArray(payload.consults) ? payload.consults : []
      const customization = payload && payload.customization && typeof payload.customization === 'object' ? payload.customization : null
      const adjustmentHistory = customization && Array.isArray(customization.history) ? customization.history : []
      const policy = payload && payload.policy && typeof payload.policy === 'object' ? payload.policy : null
      const hasCustom = hasCustomization(customization)
      const rawStats = payload && payload.stats && typeof payload.stats === 'object' ? payload.stats : null
      const questionMin = protocol && protocol.limits && finite(protocol.limits.questionMin)
        ? Math.max(1, Math.trunc(protocol.limits.questionMin))
        : QUESTION_MIN
      const stats = {
        teams: teams.length,
        experts: experts.length,
        consults: rawStats && finite(rawStats.total) ? rawStats.total : consults.length,
        tokens: rawStats && finite(rawStats.tokens)
          ? rawStats.tokens
          : consults.reduce((sum, item) => sum + (finite(item.tokens) ? item.tokens : 0), 0),
      }
      const [view, setView] = React.useState({ kind: 'list' })
      const [consultRevision, setConsultRevision] = React.useState(0)
      const [selectedDomainId, setSelectedDomainId] = React.useState('')
      const [flash, setFlash] = React.useState(null)
      const [resetConfirm, setResetConfirm] = React.useState(false)
      const [resetPending, setResetPending] = React.useState(false)
      const [resetError, setResetError] = React.useState(null)
      const pageRef = React.useRef(null)
      const detailRef = React.useRef(null)
      const load = council.reload

      const refreshAll = React.useCallback(async () => {
        await load(false)
        setConsultRevision((value) => value + 1)
      }, [load])

      const openTeam = React.useCallback((teamId, focus) => {
        if (!nonEmpty(teamId)) return
        setView({ kind: 'team', teamId, focus: focus === 'convene' ? 'convene' : undefined })
      }, [])

      const openConsult = React.useCallback((consultId) => {
        if (!nonEmpty(consultId)) return
        setView({ kind: 'consult', id: consultId })
      }, [])

      const openTeamEditor = React.useCallback((teamId) => {
        setView(teamId && nonEmpty(teamId) ? { kind: 'team-edit', teamId } : { kind: 'team-edit' })
      }, [])

      const openExperts = React.useCallback(() => {
        setView({ kind: 'experts' })
      }, [])

      const openExpertEditor = React.useCallback((expertId) => {
        setView(expertId && nonEmpty(expertId) ? { kind: 'expert-edit', expertId } : { kind: 'expert-edit' })
      }, [])

      const back = React.useCallback(() => {
        setView((current) => backTargetOf(current))
      }, [])

      const scrollTop = React.useCallback(() => {
        const node = pageRef.current
        if (!node) return
        try {
          if (typeof node.scrollTo === 'function') node.scrollTo({ top: 0, behavior: 'auto' })
          else node.scrollTop = 0
        } catch (error) {
          node.scrollTop = 0
        }
      }, [])

      React.useEffect(() => {
        if (view.kind === 'list') return undefined
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          setView((current) => backTargetOf(current))
        }
        window.addEventListener('keydown', onKeyDown)
        return () => {
          window.removeEventListener('keydown', onKeyDown)
        }
      }, [view.kind])

      React.useEffect(() => {
        if (view.kind === 'list') return
        scrollTop()
        const node = detailRef.current
        if (node && typeof node.focus === 'function') node.focus()
      }, [view, scrollTop])

      const convene = React.useCallback(
        async (teamId, form) => {
          const body = {
            action: 'convene',
            teamId,
            question: form.question,
            mode: form.mode,
            intent: INTENT_IDS.includes(form.intent) ? form.intent : defaultIntent(protocol),
          }
          if (nonEmpty(form.context)) body.context = form.context
          if (finite(form.budgetCap)) body.budgetCap = form.budgetCap
          const result = await apiPost(body)
          const consultId = result && nonEmpty(result.consultId) ? result.consultId : ''
          const brief = result && nonEmpty(result.brief) ? result.brief : ''
          if (!consultId || !brief) throw councilError('errorUnexpected')
          let launched = null
          let sessionError = null
          try {
            launched = await startSessionWithBrief(ctx, `${brief}\n\n${t('briefConsultId')}: ${consultId}`)
          } catch (launchError) {
            sessionError = t('sessionLaunchFailed', { message: describeError(t, launchError) })
          }
          await refreshAll()
          return {
            consultId,
            mode: launched ? launched.mode : 'failed',
            sessionId: launched ? launched.sessionId : null,
            sessionError,
          }
        },
        [ctx, refreshAll, t],
      )

      const handleConvene = React.useCallback(
        (teamId) => (form) => convene(teamId, form),
        [convene],
      )

      const archiveConsult = React.useCallback(
        async (consultId) => {
          await apiPost({ action: 'archive', id: consultId })
          await refreshAll()
        },
        [refreshAll],
      )

      /** Domain launch: file the consult, and optionally start the real run immediately. */
      const conveneDomain = React.useCallback(
        async (form) => {
          const body = {
            action: 'convene',
            domainId: form.domainId,
            question: form.question,
            mode: form.mode,
            intent: INTENT_IDS.includes(form.intent) ? form.intent : defaultIntent(protocol),
          }
          const result = await apiPost(body)
          const consultId = result && nonEmpty(result.consultId) ? result.consultId : ''
          if (!consultId) throw councilError('errorUnexpected')
          if (form.runNow) {
            try {
              await apiPost({ action: 'run', id: consultId })
            } catch (failure) {
              // The consult was filed; keep it visible even when the run cannot start.
              await refreshAll()
              throw failure
            }
          }
          await refreshAll()
          openConsult(consultId)
          return { consultId }
        },
        [refreshAll, openConsult],
      )

      const startRun = React.useCallback(
        async (consultId) => {
          const result = await apiPost({ action: 'run', id: consultId })
          await refreshAll()
          return result
        },
        [refreshAll],
      )

      const cancelRun = React.useCallback(
        async (consultId) => {
          const result = await apiPost({ action: 'cancel-run', id: consultId })
          await refreshAll()
          return result
        },
        [refreshAll],
      )

      const saveTeamEntity = React.useCallback(
        async (payload) => {
          const result = await apiPost({ action: 'save-team', team: payload })
          await refreshAll()
          setFlash(t('teamSaved'))
          return result
        },
        [refreshAll, t],
      )

      const saveExpertEntity = React.useCallback(
        async (payload) => {
          const result = await apiPost({ action: 'save-expert', expert: payload })
          await refreshAll()
          setFlash(t('expertSaved'))
          return result
        },
        [refreshAll, t],
      )

      const deleteEntity = React.useCallback(
        async (kind, id) => {
          const result = await apiPost({ action: 'delete', kind, id })
          await refreshAll()
          if (result && result.hidden === true) setFlash(t('hiddenDone', { id }))
          else setFlash(t('deletedDone', { id }))
          return result
        },
        [refreshAll, t],
      )

      const resetCustomization = React.useCallback(async () => {
        const result = await apiPost({ action: 'reset-custom', confirm: true })
        await refreshAll()
        setFlash(t('resetDone'))
        return result
      }, [refreshAll, t])

      const deleteTeamAction = React.useCallback(
        async (team) => {
          await deleteEntity('team', team.id)
          setView({ kind: 'list' })
        },
        [deleteEntity],
      )

      /** Turn one plain-language sentence into a session brief; the Host does not mutate the catalog. */
      const nlRequest = React.useCallback(
        async (text) => {
          const result = await apiPost({ action: 'nl-request', text })
          const brief = result && nonEmpty(result.brief) ? result.brief : ''
          if (!brief) throw councilError('errorUnexpected')
          let launched = null
          let sessionError = null
          try {
            launched = await startSessionWithBrief(ctx, `${brief}\n\n${t('nlSessionNote')}`)
          } catch (launchError) {
            sessionError = t('sessionLaunchFailed', { message: describeError(t, launchError) })
          }
          await refreshAll()
          return {
            mode: launched ? launched.mode : 'failed',
            sessionId: launched ? launched.sessionId : null,
            sessionError,
          }
        },
        [ctx, refreshAll, t],
      )

      const runReset = async () => {
        if (resetPending) return
        setResetPending(true)
        setResetError(null)
        try {
          await resetCustomization()
          setResetConfirm(false)
        } catch (failure) {
          setResetError(t('resetFailed', { message: describeError(t, failure) }))
        } finally {
          setResetPending(false)
        }
      }

      const selectedTeam = view.kind === 'team' ? teams.find((team) => team.id === view.teamId) || null : null
      const editingTeam = view.kind === 'team-edit' && nonEmpty(view.teamId) ? teams.find((team) => team.id === view.teamId) || null : null
      const editingExpert = view.kind === 'expert-edit' && nonEmpty(view.expertId) ? experts.find((expert) => expert.id === view.expertId) || null : null
      const selectedDomain = nonEmpty(selectedDomainId) ? domains.find((domain) => domain.id === selectedDomainId) || null : null
      const activeRunSnapshot = view.kind === 'consult' ? activeRuns.find((item) => item.consultId === view.id) || null : null
      const showList =
        view.kind === 'list' ||
        (view.kind === 'team' && !selectedTeam) ||
        (view.kind === 'team-edit' && nonEmpty(view.teamId) && !editingTeam) ||
        (view.kind === 'expert-edit' && nonEmpty(view.expertId) && !editingExpert)

      const listBody = h(
        React.Fragment,
        null,
        h(ConsentNotice, { t, policy }),
        runtimeAvailable ? null : h('div', { className: 'ec-notice ec-notice-warn', role: 'status' }, h('span', null, t('runtimeWarning'))),
        h(
          'section',
          { className: 'ec-section' },
          h(SectionHeader, { title: t('overviewTitle'), desc: t('overviewDesc') }),
          h(StatsRow, { t, stats }),
        ),
        h(
          'section',
          { className: 'ec-section' },
          h(SectionHeader, { title: t('domainsTitle'), count: domains.length, desc: t('domainsDesc') }),
          domains.length === 0
            ? h('p', { className: 'ec-empty-inline' }, t('domainEmpty'))
            : h(
                React.Fragment,
                null,
                h(
                  'div',
                  { className: 'ec-domains' },
                  domains.map((domain) =>
                    h(DomainCard, {
                      key: domain.id,
                      t,
                      lang,
                      domain,
                      selected: Boolean(selectedDomain) && selectedDomain.id === domain.id,
                      onSelect: setSelectedDomainId,
                    }),
                  ),
                ),
                selectedDomain
                  ? h(DomainLaunchForm, {
                      key: selectedDomain.id,
                      t,
                      domain: selectedDomain,
                      protocol,
                      questionMin,
                      llmAvailable: runtimeAvailable,
                      onLaunch: conveneDomain,
                    })
                  : null,
              ),
        ),
        h(
          'section',
          { className: 'ec-section' },
          h(SectionHeader, { title: t('nlTitle'), desc: t('nlDesc') }),
          h(NaturalLanguageRequest, { t, onSubmit: nlRequest }),
        ),
        h(RecentAdjustments, { t, history: adjustmentHistory }),
        h(
          'section',
          { className: 'ec-section' },
          h(SectionHeader, {
            title: t('teamsTitle'),
            count: teams.length,
            desc: t('teamsDesc'),
            actions: [
              hasCustom
                ? h(
                    'button',
                    { key: 'reset', type: 'button', className: 'ec-btn ec-btn-sm', onClick: () => setResetConfirm(true) },
                    t('resetCustom'),
                  )
                : null,
              h('button', { key: 'experts', type: 'button', className: 'ec-btn ec-btn-sm', onClick: openExperts }, t('expertLenses')),
              h(
                'button',
                { key: 'new', type: 'button', className: 'ec-btn ec-btn-sm ec-btn-primary', onClick: () => openTeamEditor() },
                t('newTeam'),
              ),
            ],
          }),
          resetConfirm
            ? h(ConfirmRow, {
                t,
                message: t('resetConfirm'),
                confirmLabel: t('confirmReset'),
                pending: resetPending,
                error: resetError,
                onCancel: () => {
                  setResetConfirm(false)
                  setResetError(null)
                },
                onConfirm: () => {
                  void runReset()
                },
              })
            : null,
          teams.length === 0
            ? h(EmptyState, { t, showGlyph: true, title: t('teamsTitle'), hint: t('recentEmpty') })
            : h(
                'div',
                { className: 'ec-teams' },
                teams.map((team) =>
                  h(TeamCard, {
                    key: team.id,
                    t,
                    lang,
                    team,
                    onView: openTeam,
                    onConvene: (teamId) => {
                      openTeam(teamId, 'convene')
                    },
                  }),
                ),
              ),
        ),
        h(RecentConsults, { t, lang, consults, teams, domains, onOpen: openConsult }),
      )

      let detail = null
      if (view.kind === 'team' && selectedTeam) {
        detail = h(TeamDetail, {
          key: `${selectedTeam.id}:${view.focus || ''}`,
          t,
          lang,
          team: selectedTeam,
          experts,
          protocol,
          questionMin,
          onBack: back,
          focusConvene: view.focus === 'convene',
          onConvene: handleConvene(selectedTeam.id),
          onEdit: () => openTeamEditor(selectedTeam.id),
          onDelete: deleteTeamAction,
        })
      } else if (view.kind === 'team-edit' && (!nonEmpty(view.teamId) || editingTeam)) {
        detail = h(TeamEditor, {
          key: `team-edit:${nonEmpty(view.teamId) ? view.teamId : 'new'}`,
          t,
          lang,
          team: nonEmpty(view.teamId) ? editingTeam : null,
          experts,
          protocol,
          onSave: saveTeamEntity,
          onSaved: (result, fallbackId) => {
            const nextId = result && nonEmpty(result.id) ? result.id : fallbackId
            if (nonEmpty(nextId)) openTeam(nextId)
            else setView({ kind: 'list' })
          },
          onCancel: back,
        })
      } else if (view.kind === 'experts') {
        detail = h(ExpertsView, {
          t,
          lang,
          experts,
          domains,
          protocol,
          onBack: back,
          onNew: () => openExpertEditor(),
          onEdit: openExpertEditor,
          onDelete: deleteEntity,
        })
      } else if (view.kind === 'expert-edit' && (!nonEmpty(view.expertId) || editingExpert)) {
        detail = h(ExpertEditor, {
          key: `expert-edit:${nonEmpty(view.expertId) ? view.expertId : 'new'}`,
          t,
          lang,
          expert: nonEmpty(view.expertId) ? editingExpert : null,
          domains,
          protocol,
          onSave: saveExpertEntity,
          onSaved: () => setView({ kind: 'experts' }),
          onCancel: back,
        })
      } else if (view.kind === 'consult') {
        detail = h(ConsultDetail, {
          t,
          lang,
          id: view.id,
          revision: consultRevision,
          team: null,
          reportAvailable: false,
          runSnapshot: activeRunSnapshot,
          runtimeUnavailable: !runtimeAvailable,
          onBack: back,
          onRetry: refreshAll,
          onRefresh: refreshAll,
          onArchive: archiveConsult,
          onStartRun: startRun,
          onCancelRun: cancelRun,
        })
      }

      return h(
        'div',
        { className: 'ec-page', ref: pageRef },
        h('style', null, STYLES),
        h(
          'div',
          { className: 'ec-shell' },
          h(PageHeader, {
            t,
            updatedAt: council.updatedAt,
            busy: council.busy,
            onRefresh: () => {
              void load(true)
            },
          }),
          h('div', { className: 'ec-head-rule', 'aria-hidden': true }),
          flash
            ? h(
                'div',
                { className: 'ec-feedback ec-feedback-ok', role: 'status' },
                h('span', { className: 'ec-feedback-text' }, flash),
              )
            : null,
          council.error
            ? h(ErrorBar, {
                message: t('errorLoad', { message: describeError(t, council.error) }),
                retryLabel: t('retry'),
                onRetry: () => {
                  void load(true)
                },
              })
            : null,
          !payload && council.loading ? h('div', { className: 'ec-state' }, t('loading')) : null,
          !payload && !council.loading && !council.error ? h(EmptyState, { t, showGlyph: true, title: t('teamsTitle'), hint: t('recentEmpty') }) : null,
          payload && showList ? listBody : null,
          payload && !showList && detail
            ? h('div', { className: 'ec-detail-wrap', ref: detailRef, tabIndex: -1, style: { outline: 'none' } }, detail)
            : null,
        ),
      )
    }

    return {
      /** Client services this plugin needs before it may activate. */
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICTIONARIES), 'dsh-expert-council: dictionaries')
        const t = createTranslator(ctx.locale.bind(NS))

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 31,
              label: () => t('panel'),
              locale: NS,
            },
            CouncilIcon,
          ),
        )

        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: PANEL_ID,
              locale: NS,
            },
            () => h(CouncilPanel, { sourceT: t, ctx }),
          ),
        )
      },
    }
  },
})
