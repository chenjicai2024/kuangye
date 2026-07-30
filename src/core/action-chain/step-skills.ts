import { STEP_TYPE_LABELS, type StepType } from './types'

export interface StepSkillDescription {
  label: string
  purpose: string
  reads: readonly string[]
  writes: readonly string[]
  sideEffects: readonly string[]
  constraints: readonly string[]
}

function skill(
  type: StepType,
  purpose: string,
  reads: string[],
  writes: string[],
  sideEffects: string[],
  constraints: string[]
): StepSkillDescription {
  return { label: STEP_TYPE_LABELS[type], purpose, reads, writes, sideEffects, constraints }
}

/**
 * 节点对 AI 构建助手公开的 Skill 语义目录。
 * 这里描述真实运行行为；用户可编辑字段仍以 editor-capabilities.ts 为唯一权限来源。
 */
export const STEP_SKILL_CATALOG = {
  detect_pixel_change: skill(
    'detect_pixel_change',
    '进入节点时建立当前区域的像素基线，然后每 500ms 检查一次，阻塞到画面发生变化。',
    ['目标区域', '节点 timeoutMs'],
    ['区域名_changed=true（仅检测到变化后）', '该区域的内存像素基线'],
    ['持续截取目标区域直到变化、超时或引擎停止'],
    ['每次进入都会先覆盖旧基线；它不是单次比较节点']
  ),
  check_pixel_diff: skill(
    'check_pixel_diff',
    '把目标区域当前画面与内存中已有基线做一次像素差异比较。',
    ['目标区域', '此前由刷新像素或等待像素变化建立的内存基线'],
    ['区域名_diff=true|false'],
    ['单次截取目标区域'],
    ['没有基线时直接输出 false，不会自动建立基线；当前变化阈值为 5%']
  ),
  detect_red_dot: skill(
    'detect_red_dot',
    '单次计算目标区域内符合红点颜色规则的像素比例。',
    ['目标区域'],
    ['区域名_red_ratio=百分比数值'],
    ['单次截取目标区域'],
    ['只测量不等待；比例数值按 0 到 100 表示']
  ),
  wait_red_dot: skill(
    'wait_red_dot',
    '阻塞等待目标区域的红色像素比例超过设定阈值。',
    ['目标区域', 'redDotThreshold', '节点 timeoutMs'],
    ['区域名_red_dot=true|false', '区域名_red_ratio=百分比数值'],
    ['每 500ms 截取并检测目标区域'],
    ['进入节点时红点已经存在也会立即通过；这是流程节点，不是后台监听器']
  ),
  set_baseline: skill(
    'set_baseline',
    '立即把目标区域当前截图保存为新的内存像素基线。',
    ['目标区域'],
    ['该区域的内存像素基线'],
    ['单次截取目标区域'],
    ['基线只存在于本次引擎运行内，程序重启后不会保留']
  ),
  refresh_window_anchor: skill(
    'refresh_window_anchor',
    '找到窗口锚点，将窗口恢复到捕获时保存的尺寸，并重新读取位置和尺寸。',
    ['windowAnchorId 或 refreshAllWindowAnchors', '捕获时保存的窗口尺寸'],
    ['windowAnchors 运行变量', '窗口解析缓存'],
    ['可能调整真实窗口尺寸'],
    ['校准失败会报错；执行后清空旧的 UI 区域定位缓存']
  ),
  relocate_window_anchor: skill(
    'relocate_window_anchor',
    '重新读取窗口锚点当前的位置和尺寸，供后续窗口相对区域换算。',
    ['windowAnchorId 或 refreshAllWindowAnchors'],
    ['windowAnchors 运行变量', '窗口解析缓存'],
    ['读取真实窗口位置，不调整窗口大小'],
    ['执行后清空旧的 UI 区域定位缓存']
  ),
  adjust_ui_layout: skill(
    'adjust_ui_layout',
    '比较捕获时的窗口标准截图与当前窗口截图，让视觉模型规划并执行最多一个布局修正动作。',
    ['窗口锚点标准截图', '当前窗口截图', 'layoutInstruction', 'layoutAllowedAction'],
    [],
    ['按置信度执行一个受窗口边界限制的拖动或点击'],
    ['窗口尺寸必须先校准；AI 置信度低于 minConfidence 时禁止操作']
  ),
  locate_ui_region: skill(
    'locate_ui_region',
    '通过模板匹配或相对偏移，在运行时重新确定已有区域的位置。',
    ['目标区域', '区域模板截图或基准区域', '搜索范围与匹配参数'],
    ['uiRegions[区域名] 运行变量', '该区域的运行时定位缓存'],
    ['模板模式会截取搜索范围'],
    ['只更新运行时位置，不改写 Workspace 中的框选区域']
  ),
  ai_locate_ui_region: skill(
    'ai_locate_ui_region',
    '让视觉模型根据自然语言描述，从指定搜索范围截图中定位已有区域。',
    ['uiVisionPrompt', '搜索范围截图', '可选参考区域模板截图'],
    ['uiRegions[区域名] 运行变量', '该区域的运行时定位缓存'],
    ['调用视觉模型读取截图'],
    ['只接受有效 bbox；只更新运行时位置，不改写 Workspace']
  ),
  call_chain: skill(
    'call_chain',
    '调用一个已有动作链，完成后回到当前链继续执行。',
    ['callChainName', '当前共享运行变量'],
    ['被调用动作链产生的共享运行变量'],
    ['执行目标动作链中的节点'],
    ['只能调用已存在的动作链；应避免递归调用形成无限循环']
  ),
  if_else: skill(
    'if_else',
    '计算单个或组合条件，并选择 true 或 false 出口。',
    ['condition 引用的运行变量'],
    ['内部条件结果，供 true/false 连线选路'],
    [],
    ['true/false 连线必须与业务语义对应；不要按 nodes 数组顺序推断分支']
  ),
  random_branch: skill(
    'random_branch',
    '按各条出边的 probabilityWeight 相对权重随机选择一条路线。',
    ['两条或更多出边及其 probabilityWeight'],
    ['本轮选中的下一节点'],
    [],
    ['权重是相对值，不要求总和正好为 100；至少需要两条有效出边']
  ),
  jump_to: skill(
    'jump_to',
    '把流程跳转到指定节点 ID，或兼容旧版步骤编号。',
    ['jumpToNodeId 或 jumpToStep'],
    ['内部跳转目标'],
    [],
    ['目标不存在会失败；可形成循环，必须检查退出条件']
  ),
  click: skill(
    'click',
    '在目标区域中心或区域内安全随机位置执行单击或双击。',
    ['目标区域', 'clickPolicy', 'clickPositionMode'],
    [],
    ['移动鼠标并点击真实桌面'],
    ['目标区域必须可解析；双击由两次左键点击组成']
  ),
  random_mouse: skill(
    'random_mouse',
    '在目标区域内按随机路径移动鼠标若干次，并在移动之间随机停顿。',
    ['目标区域', '移动次数范围', '停顿时间范围'],
    [],
    ['移动真实鼠标'],
    ['全程不点击；适合模拟自然鼠标活动']
  ),
  right_click: skill(
    'right_click',
    '在目标区域中心执行一次右键点击。',
    ['目标区域'],
    [],
    ['移动鼠标并右键点击真实桌面'],
    ['固定使用区域中心']
  ),
  drag: skill(
    'drag',
    '从起点区域中心拖动到终点区域中心。',
    ['目标区域作为起点', 'dragEndRegion 作为终点'],
    [],
    ['在真实桌面执行鼠标拖动'],
    ['起点和终点区域都必须存在并能解析']
  ),
  key_press: skill(
    'key_press',
    '向当前获得焦点的应用发送一个按键。',
    ['keyName', '当前系统焦点'],
    [],
    ['发送真实键盘按键'],
    ['不负责定位输入区域；例如发送文字应在 type_text 后单独使用 Enter']
  ),
  hotkey: skill(
    'hotkey',
    '向当前获得焦点的应用发送修饰键与主键组合。',
    ['keyName', 'modifiers', '当前系统焦点'],
    [],
    ['发送真实组合键'],
    ['不负责定位目标应用，效果取决于当前焦点']
  ),
  screenshot_to_ai: skill(
    'screenshot_to_ai',
    '截取目标区域并交给视觉模型分析，可返回文本或受 schema 约束的结构化结果。',
    ['目标区域当前截图', 'aiPrompt', 'outputMode', 'outputSchema'],
    ['variableName', '结构化 schema 中定义的各字段变量'],
    ['调用视觉模型；把截图和 AI 响应写入运行轨迹'],
    ['action_plan 模式会把完整对象写入 variableName；本节点只分析，不执行动作']
  ),
  extract_chat_details: skill(
    'extract_chat_details',
    '截取聊天区域，解析会话标题、会话类型及按时间排序的可见消息。',
    ['目标聊天区域当前截图'],
    ['chatSnapshotVariable，默认 chatSnapshot'],
    ['调用视觉模型'],
    ['必须区分聊天原文与媒体视觉描述；只解析当前画面可见内容']
  ),
  record_chat_history: skill(
    'record_chat_history',
    '把聊天快照去重保存，或把已成功发送的我方回复追加到项目隔离的聊天记录。',
    ['chatRecordMode 对应的快照、会话引用或回复变量'],
    ['snapshot 模式写入 chatConversationVariable 会话引用', '本地持久化聊天记录'],
    ['写入当前智能体的聊天历史文件'],
    ['outgoing_reply 模式应放在 Enter 发送成功之后，避免记录未发送内容']
  ),
  generate_chat_reply: skill(
    'generate_chat_reply',
    '读取已保存会话历史，根据回复要求生成可供后续输入节点使用的回复文本。',
    ['chatConversationVariable', '聊天历史', 'chatReplyPrompt', '可选当前聊天截图'],
    ['chatReplyVariable，默认 chatReply'],
    ['调用文本模型或视觉模型'],
    ['只生成变量，不输入也不发送；是否附图由 chatIncludeScreenshot 控制']
  ),
  type_text: skill(
    'type_text',
    '解析文本模板中的运行变量后，把文字输入目标区域。',
    ['目标区域', 'textTemplate', '运行变量', '即时或渐进输入参数'],
    [],
    ['聚焦目标区域并向真实桌面输入文字'],
    ['绝不按 Enter；发送必须连接独立 key_press 节点']
  ),
  wait: skill(
    'wait',
    '暂停流程固定时长，或在最短和最长时间之间随机选择一次等待时长。',
    ['waitMode 与对应毫秒参数'],
    [],
    ['延迟当前流程'],
    ['随机等待会在每次进入节点时重新抽取时长']
  ),
  execute_ai_actions: skill(
    'execute_ai_actions',
    '读取 AIActionPlan 变量，经过置信度、数量、动作类型和区域边界检查后执行动作。',
    ['variableName 对应的 AIActionPlan', '可选限制区域', 'minConfidence', 'maxActions'],
    [],
    ['可能执行点击、右键、拖动、输入并发送、按键或组合键'],
    [
      '只执行通过安全过滤的动作',
      '当前 action plan 中的 type_text 会输入并按 Enter，和普通 type_text 节点语义不同'
    ]
  ),
  parallel: skill(
    'parallel',
    '分叉点：同时启动所有出线分支，配合后续的并行处理节点使用。',
    [],
    [],
    [],
    ['需要后续连接并行处理节点来汇聚结果', '暂不支持嵌套并行']
  ),
  parallel_process: skill(
    'parallel_process',
    '汇聚点：收集并行节点的分支结果。竞争模式取第一个到达的，采集模式等全部完成。',
    ['parallelMode'],
    [],
    [],
    ['竞争模式下先到的分支会触发停止其他分支', '采集模式下等待所有分支完成']
  ),
  trigger: skill(
    'trigger',
    '触发节点：启动或停止指定的目标节点。启动模式让目标节点重新执行，停止模式中断目标节点。',
    ['triggerMode', 'triggerTargetNodeId'],
    [],
    ['停止模式会中断目标节点的执行'],
    ['启动模式等价于跳转到目标节点', '停止模式用于特殊场景的中断控制']
  ),
  loop_counter: skill(
    'loop_counter',
    '循环计数器：每次执行到此节点时计数+1，达到最大次数后从"退出"口离开。',
    ['loopMaxCount'],
    [],
    ['计数器在重新运行时自动归零'],
    ['"继续"口连接下一个节点，"退出"口连接离开循环的路径']
  )
} as const satisfies Record<StepType, StepSkillDescription>

export function agentStepSkillCatalogPayload(): Record<StepType, StepSkillDescription> {
  return STEP_SKILL_CATALOG
}
