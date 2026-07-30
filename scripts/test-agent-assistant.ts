import assert from 'node:assert/strict'
import type {
  AgentAssistantActor,
  AgentAssistantModelRequest
} from '../src/core/agent-assistant/orchestrator'
import {
  isAgentAssistantContinuation,
  orchestrateAgentAssistant,
  parseAgentAssistantReview,
  parseAgentAssistantSpecialistReport,
  planAgentAssistantOrchestration,
  selectAgentAssistantSpecialists
} from '../src/core/agent-assistant/orchestrator'
import type {
  AgentAssistantCollaborationContext,
  AgentContextSnapshot,
  AgentEditProposal
} from '../src/core/agent-assistant/types'
import {
  AgentAssistantJsonFormatError,
  formatAgentAssistantDisplayText,
  parseAgentAssistantResponse,
  simulateAgentEditProposal
} from '../src/core/agent-assistant/proposal'
import {
  AGENT_ASSISTANT_SYSTEM_PROMPT,
  buildAgentAssistantUserPrompt
} from '../src/core/agent-assistant/prompt'
import { selectAgentProjectAssetReferences } from '../src/core/agent-assistant/project-assets'
import { STEP_SKILL_CATALOG } from '../src/core/action-chain/step-skills'
import { STEP_TYPE_LABELS, type Workspace } from '../src/core/action-chain/types'

function workspaceFixture(): Workspace {
  return {
    windowAnchors: [
      {
        id: 'anchor-1',
        name: '微信主窗口',
        title: '微信',
        ownerName: 'Weixin',
        capturedBounds: { x: 0, y: 0, width: 800, height: 600 },
        capturedImagePath: 'action-chain-assets/project-1/window.png'
      }
    ],
    views: [
      {
        name: '默认视图',
        regions: [
          {
            name: '输入框',
            rect: { x: 10, y: 10, width: 100, height: 40 },
            coordinateMode: 'window',
            windowAnchorId: 'anchor-1',
            templateImagePath: 'action-chain-assets/project-1/input.png'
          }
        ]
      }
    ],
    executionChains: [
      {
        id: 'exec-1',
        name: '执行链1',
        description: '负责接收任务并完成主流程。',
        enabled: true,
        trigger: 'manual',
        nodes: [
          {
            id: 'node-1',
            type: 'click',
            position: { x: 100, y: 100 },
            data: { type: 'click', region: '输入框' }
          }
        ],
        edges: []
      }
    ],
    chains: [
      {
        id: 'chain-1',
        name: '公共动作',
        description: '提供可复用的公共操作。',
        enabled: false,
        trigger: 'sub',
        nodes: [
          {
            id: 'node-2',
            type: 'wait',
            position: { x: 100, y: 100 },
            data: { type: 'wait', params: { waitMs: 500 } }
          }
        ],
        edges: []
      }
    ]
  }
}

function parseProposal(raw: object, revision = 3): AgentEditProposal {
  const response = parseAgentAssistantResponse(JSON.stringify(raw), 'project-1', revision)
  assert.equal(response.type, 'edit_proposal')
  assert.ok(response.proposal)
  return response.proposal
}

async function run(): Promise<void> {
  const source = workspaceFixture()
  const answer = parseAgentAssistantResponse(
    JSON.stringify({ type: 'answer', content: '当前执行链包含一个点击节点。' }),
    'project-1',
    1
  )
  assert.equal(answer.type, 'answer')
  assert.equal(answer.proposal, undefined)
  assert.equal(source.executionChains[0].nodes.length, 1)

  const doubleWrappedAnswer = parseAgentAssistantResponse(
    JSON.stringify({
      type: 'answer',
      content: JSON.stringify({ type: 'answer', content: '我看到了项目保存的两张截图。' })
    }),
    'project-1',
    1
  )
  assert.equal(doubleWrappedAnswer.type, 'answer')
  assert.equal(doubleWrappedAnswer.content, '我看到了项目保存的两张截图。')
  assert.equal(
    formatAgentAssistantDisplayText(
      JSON.stringify({
        type: 'answer',
        content: JSON.stringify({ type: 'clarification', content: '你希望查看哪一张？' })
      })
    ),
    '你希望查看哪一张？'
  )

  const malformedMultilineAnswer = `{"type":"answer","content":"### 当前流程
第 1 个节点是**等待红点**，节点 ID 为\`node-1\`。
1. 继续分析
2. 给出建议"}`
  const repairedAnswer = parseAgentAssistantResponse(malformedMultilineAnswer, 'project-1', 1)
  assert.equal(repairedAnswer.type, 'answer')
  assert.equal(
    repairedAnswer.content,
    '当前流程\n第 1 个节点是等待红点，节点 ID 为node-1。\n1. 继续分析\n2. 给出建议'
  )
  assert.equal(formatAgentAssistantDisplayText(malformedMultilineAnswer), repairedAnswer.content)
  const repairedMultilineProposal = parseAgentAssistantResponse(
    `模型结果如下：
\`\`\`json
{"type":"edit_proposal","summary":"补充链说明
并保留换行","operations":[{"type":"update_chain","chainKind":"executionChain","chainId":"exec-1","patch":{"description":"负责观察棋盘
并生成下一步动作"}}],}
\`\`\``,
    'project-1',
    1
  )
  assert.equal(repairedMultilineProposal.type, 'edit_proposal')
  assert.equal(repairedMultilineProposal.proposal?.summary, '补充链说明\n并保留换行')
  assert.equal(
    repairedMultilineProposal.proposal?.operations[0].type === 'update_chain'
      ? repairedMultilineProposal.proposal.operations[0].patch.description
      : undefined,
    '负责观察棋盘\n并生成下一步动作'
  )
  assert.throws(
    () =>
      parseAgentAssistantResponse(
        '{"type":"edit_proposal","summary":"内容被截断","operations":[',
        'project-1',
        1
      ),
    AgentAssistantJsonFormatError
  )

  const promptPayload = JSON.parse(
    buildAgentAssistantUserPrompt(
      '解释当前流程',
      {
        projectId: 'project-1',
        projectName: '测试智能体',
        workspace: source,
        workspaceRevision: 1,
        activeChainKind: 'executionChain',
        activeChainId: 'exec-1',
        canvas: { pan: { x: 0, y: 0 }, zoom: 1, width: 800, height: 600 },
        recentRuntimeLogs: [],
        diagnostics: {
          collectedAt: 10,
          liveEngineState: {
            running: true,
            currentChain: '执行链1',
            currentStep: 1,
            errors: [],
            variables: {}
          },
          workMemory: {
            sessions: [
              {
                id: 'run-1',
                projectId: 'project-1',
                chainId: 'exec-1',
                chainName: '执行链1',
                chainType: 'executionChain',
                startedAt: 1,
                status: 'error',
                totalSteps: 1,
                completedSteps: 0,
                errorCount: 1,
                steps: [
                  {
                    stepIndex: 0,
                    nodeId: 'node-1',
                    stepType: 'click',
                    status: 'error',
                    message: '未找到目标区域',
                    startedAt: 1
                  }
                ]
              }
            ],
            cards: []
          },
          chatHistory: [
            {
              id: 'project-1:direct:客户a',
              projectId: 'project-1',
              conversationTitle: '客户A',
              conversationType: 'direct',
              firstCapturedAt: 1,
              lastCapturedAt: 2,
              messages: []
            }
          ],
          visualEvidence: {
            canvasCaptured: true,
            fullScreenCaptured: false,
            workMemoryScreenshotCount: 0,
            projectAssetAvailableCount: 2,
            projectAssetScreenshotCount: 2,
            projectAssetScreenshotLabels: [
              '框选区域：默认视图 / 输入框',
              '窗口标准截图：微信主窗口'
            ],
            projectAssetOmittedCount: 0
          }
        }
      },
      [
        {
          id: 'legacy-message',
          role: 'assistant',
          content: malformedMultilineAnswer,
          createdAt: 1,
          responseType: 'answer'
        }
      ]
    )
  ) as {
    conversation: Array<{ content: string }>
    context: {
      diagnostics: { liveEngineState: { running: boolean } }
      editorCapabilities: {
        nodeTypeIsReadOnlyAfterCreation: boolean
        stepTypes: { screenshot_to_ai: { params: string[] } }
      }
      nodeRuntimeSemantics: Record<string, string>
      nodeSkills: typeof STEP_SKILL_CATALOG
      workspace: {
        executionChains: Array<{ description?: string; nodes: Array<{ displayIndex: number }> }>
      }
    }
  }
  assert.equal(promptPayload.context.workspace.executionChains[0].nodes[0].displayIndex, 1)
  assert.equal(
    promptPayload.context.workspace.executionChains[0].description,
    '负责接收任务并完成主流程。'
  )
  assert.equal(promptPayload.conversation[0].content, repairedAnswer.content)
  assert.match(promptPayload.context.nodeRuntimeSemantics.check_pixel_diff, /没有基线.*false/)
  assert.equal(
    Object.keys(promptPayload.context.nodeSkills).length,
    Object.keys(STEP_TYPE_LABELS).length
  )
  assert.match(promptPayload.context.nodeSkills.type_text.constraints.join('\n'), /绝不按 Enter/)
  assert.match(
    promptPayload.context.nodeSkills.execute_ai_actions.constraints.join('\n'),
    /type_text 会输入并按 Enter/
  )
  assert.equal(promptPayload.context.diagnostics.liveEngineState.running, true)
  assert.equal(promptPayload.context.editorCapabilities.nodeTypeIsReadOnlyAfterCreation, true)
  assert.ok(
    promptPayload.context.editorCapabilities.stepTypes.screenshot_to_ai.params.includes('aiPrompt')
  )
  assert.match(AGENT_ASSISTANT_SYSTEM_PROMPT, /第 N 个节点/)
  assert.match(AGENT_ASSISTANT_SYSTEM_PROMPT, /context\.nodeSkills/)
  assert.match(AGENT_ASSISTANT_SYSTEM_PROMPT, /自然、直接的对话表达/)
  assert.match(AGENT_ASSISTANT_SYSTEM_PROMPT, /项目保存的截图/)

  const assetSelection = selectAgentProjectAssetReferences(
    {
      projectId: 'project-1',
      projectName: '测试智能体',
      workspace: source,
      workspaceRevision: 1,
      activeChainKind: 'executionChain',
      activeChainId: 'exec-1',
      selectedNodeId: 'node-1',
      canvas: { pan: { x: 0, y: 0 }, zoom: 1, width: 800, height: 600 },
      recentRuntimeLogs: []
    },
    '请查看输入框的框选截图'
  )
  assert.equal(assetSelection.availableCount, 2)
  assert.equal(assetSelection.selected[0].label, '框选区域：默认视图 / 输入框')
  assert.equal(assetSelection.omittedCount, 0)

  const addWait = parseProposal({
    type: 'edit_proposal',
    summary: '在当前链尾增加等待两秒',
    operations: [
      {
        type: 'create_node',
        chainKind: 'executionChain',
        chainId: 'exec-1',
        node: { type: 'wait', data: { type: 'wait', params: { waitMs: 2000 } } }
      }
    ]
  })
  const createdNodeId =
    addWait.operations[0].type === 'create_node' ? addWait.operations[0].node.id : undefined
  assert.ok(createdNodeId)
  addWait.operations.push({
    type: 'create_edge',
    chainKind: 'executionChain',
    chainId: 'exec-1',
    edge: { source: 'node-1', target: createdNodeId! }
  })
  const addResult = simulateAgentEditProposal(source, addWait)
  assert.equal(addResult.success, true, addResult.errors.join('\n'))
  assert.equal(addResult.workspace.executionChains[0].nodes.length, 2)
  assert.equal(addResult.workspace.executionChains[0].edges.length, 1)
  assert.equal(source.executionChains[0].nodes.length, 1, '模拟不得修改真实 Workspace')

  const emptyWorkspace: Workspace = {
    windowAnchors: [],
    views: [],
    executionChains: [],
    chains: []
  }
  const buildFromEmpty = parseProposal({
    type: 'edit_proposal',
    summary: '从空白智能体创建执行链、两个节点和连线',
    operations: [
      {
        type: 'create_chain',
        chainKind: 'executionChain',
        chain: {
          name: '象棋自动对弈',
          description: '观察棋盘、生成着法并完成落子。',
          enabled: true,
          trigger: 'manual'
        }
      },
      {
        type: 'create_node',
        chainKind: 'executionChain',
        chainId: 'chain-0',
        node: { type: 'wait', data: { type: 'wait', params: { waitMs: 500 } } }
      },
      {
        type: 'create_node',
        chainKind: 'executionChain',
        chainId: 'chain-0',
        node: { type: 'wait', data: { type: 'wait', params: { waitMs: 1000 } } }
      },
      {
        type: 'create_edge',
        chainKind: 'executionChain',
        chainId: 'chain-0',
        edge: { source: 'node-0', target: 'node-1' }
      }
    ]
  })
  const buildFromEmptyResult = simulateAgentEditProposal(emptyWorkspace, buildFromEmpty)
  assert.equal(buildFromEmptyResult.success, true, buildFromEmptyResult.errors.join('\n'))
  assert.equal(buildFromEmptyResult.workspace.executionChains.length, 1)
  assert.equal(
    buildFromEmptyResult.workspace.executionChains[0].description,
    '观察棋盘、生成着法并完成落子。'
  )
  assert.equal(buildFromEmptyResult.workspace.executionChains[0].nodes.length, 2)
  assert.equal(buildFromEmptyResult.workspace.executionChains[0].edges.length, 1)
  assert.equal(
    buildFromEmptyResult.workspace.executionChains[0].edges[0].source,
    buildFromEmptyResult.workspace.executionChains[0].nodes[0].id
  )
  assert.equal(
    buildFromEmptyResult.workspace.executionChains[0].edges[0].target,
    buildFromEmptyResult.workspace.executionChains[0].nodes[1].id
  )

  const buildWithNamedRefs = parseProposal({
    type: 'edit_proposal',
    summary: '使用明确的临时引用创建完整流程',
    operations: [
      {
        type: 'create_chain',
        chainKind: 'executionChain',
        chain: { ref: 'main-chain', name: '主流程', trigger: 'manual' }
      },
      {
        type: 'create_node',
        chainKind: 'executionChain',
        chainId: 'main-chain',
        node: { ref: 'observe', type: 'wait', data: { type: 'wait', params: { waitMs: 500 } } }
      },
      {
        type: 'create_node',
        chainKind: 'executionChain',
        chainId: 'main-chain',
        node: { ref: 'decide', type: 'wait', data: { type: 'wait', params: { waitMs: 1000 } } }
      },
      {
        type: 'create_edge',
        chainKind: 'executionChain',
        chainId: 'main-chain',
        edge: { source: 'observe', target: 'decide' }
      }
    ]
  })
  const buildWithNamedRefsResult = simulateAgentEditProposal(emptyWorkspace, buildWithNamedRefs)
  assert.equal(buildWithNamedRefsResult.success, true, buildWithNamedRefsResult.errors.join('\n'))
  assert.equal(buildWithNamedRefsResult.workspace.executionChains[0].edges.length, 1)

  const deleteAddedNode = parseProposal({
    type: 'edit_proposal',
    summary: '删除节点并清理连线',
    operations: [
      {
        type: 'delete_node',
        chainKind: 'executionChain',
        chainId: 'exec-1',
        nodeId: createdNodeId
      }
    ]
  })
  const deleteNodeResult = simulateAgentEditProposal(addResult.workspace, deleteAddedNode)
  assert.equal(deleteNodeResult.success, true)
  assert.equal(deleteNodeResult.workspace.executionChains[0].nodes.length, 1)
  assert.equal(deleteNodeResult.workspace.executionChains[0].edges.length, 0)
  assert.equal(deleteNodeResult.diff.deletedEdges.length, 1)

  const updateWait = parseProposal({
    type: 'edit_proposal',
    summary: '修改等待参数',
    operations: [
      {
        type: 'update_node',
        chainKind: 'actionChain',
        chainId: 'chain-1',
        nodeId: 'node-2',
        patch: { data: { params: { waitMs: 2500 } } }
      }
    ]
  })
  const updateResult = simulateAgentEditProposal(source, updateWait)
  assert.equal(updateResult.success, true)
  assert.equal(updateResult.workspace.chains[0].nodes[0].data.params?.waitMs, 2500)

  const promptWorkspace = workspaceFixture()
  promptWorkspace.chains[0].nodes[0] = {
    id: 'node-2',
    type: 'screenshot_to_ai',
    position: { x: 100, y: 100 },
    data: {
      type: 'screenshot_to_ai',
      region: '输入框',
      params: {
        variableName: 'analysis',
        aiPrompt: '原提示词',
        outputMode: 'structured_json',
        outputSchema: [{ name: 'reply', type: 'string' }]
      }
    },
    label: '截图给AI'
  }
  const updatePrompt = parseProposal({
    type: 'edit_proposal',
    summary: '优化截图分析提示词',
    operations: [
      {
        type: 'update_node',
        chainKind: 'actionChain',
        chainId: 'chain-1',
        nodeId: 'node-2',
        patch: { data: { params: { aiPrompt: '只提取最新一条消息并说明发送者。' } } }
      }
    ]
  })
  const promptResult = simulateAgentEditProposal(promptWorkspace, updatePrompt)
  assert.equal(promptResult.success, true, promptResult.errors.join('\n'))
  assert.deepEqual(promptResult.workspace.chains[0].nodes[0].data.params, {
    variableName: 'analysis',
    aiPrompt: '只提取最新一条消息并说明发送者。',
    outputMode: 'structured_json',
    outputSchema: [{ name: 'reply', type: 'string' }]
  })

  const forbiddenWaitPrompt = parseProposal({
    type: 'edit_proposal',
    summary: '错误地给等待节点添加提示词',
    operations: [
      {
        type: 'update_node',
        chainKind: 'actionChain',
        chainId: 'chain-1',
        nodeId: 'node-2',
        patch: { data: { params: { aiPrompt: '不应允许' } } }
      }
    ]
  })
  const forbiddenWaitResult = simulateAgentEditProposal(source, forbiddenWaitPrompt)
  assert.equal(forbiddenWaitResult.success, false)
  assert.match(forbiddenWaitResult.errors.join('\n'), /不是“等待”节点的用户可编辑字段/)

  const redDotWorkspace = workspaceFixture()
  redDotWorkspace.chains[0].nodes[0] = {
    id: 'node-2',
    type: 'wait_red_dot',
    position: { x: 100, y: 100 },
    data: { type: 'wait_red_dot', region: '输入框', params: { redDotThreshold: 5 } }
  }
  const updateRedDot = parseProposal({
    type: 'edit_proposal',
    summary: '把红点阈值改为百分之二',
    operations: [
      {
        type: 'update_node',
        chainKind: 'actionChain',
        chainId: 'chain-1',
        nodeId: 'node-2',
        patch: { data: { params: { redDotThreshold: 2 } } }
      }
    ]
  })
  const redDotResult = simulateAgentEditProposal(redDotWorkspace, updateRedDot)
  assert.equal(redDotResult.success, true, redDotResult.errors.join('\n'))
  assert.equal(redDotResult.workspace.chains[0].nodes[0].data.params?.redDotThreshold, 2)

  const conditionWorkspace = workspaceFixture()
  conditionWorkspace.chains[0].nodes[0] = {
    id: 'node-2',
    type: 'if_else',
    position: { x: 100, y: 100 },
    data: {
      type: 'if_else',
      condition: { variable: '输入框_red_ratio', operator: 'greater_than', value: '5' }
    }
  }
  const updateCondition = parseProposal({
    type: 'edit_proposal',
    summary: '把条件阈值改为百分之二',
    operations: [
      {
        type: 'update_node',
        chainKind: 'actionChain',
        chainId: 'chain-1',
        nodeId: 'node-2',
        patch: {
          data: {
            condition: { variable: '输入框_red_ratio', operator: 'greater_than', value: '2' }
          }
        }
      }
    ]
  })
  const conditionResult = simulateAgentEditProposal(conditionWorkspace, updateCondition)
  assert.equal(conditionResult.success, true, conditionResult.errors.join('\n'))
  assert.equal(
    conditionResult.workspace.chains[0].nodes[0].data.condition &&
      'value' in conditionResult.workspace.chains[0].nodes[0].data.condition
      ? conditionResult.workspace.chains[0].nodes[0].data.condition.value
      : undefined,
    '2'
  )

  assert.throws(
    () =>
      parseProposal({
        type: 'edit_proposal',
        summary: '越权修改节点类型',
        operations: [
          {
            type: 'update_node',
            chainKind: 'actionChain',
            chainId: 'chain-1',
            nodeId: 'node-2',
            patch: { type: 'click' }
          }
        ]
      }),
    /未授权字段：type/
  )

  assert.throws(
    () =>
      parseProposal({
        type: 'edit_proposal',
        summary: '越权修改系统管理的节点名称',
        operations: [
          {
            type: 'update_node',
            chainKind: 'actionChain',
            chainId: 'chain-1',
            nodeId: 'node-2',
            patch: { label: '自定义名称' }
          }
        ]
      }),
    /未授权字段：label/
  )

  const updateChain = parseProposal({
    type: 'edit_proposal',
    summary: '停用执行链并设为默认启动',
    operations: [
      {
        type: 'update_chain',
        chainKind: 'executionChain',
        chainId: 'exec-1',
        patch: { description: '更新后的主流程说明。', enabled: false, trigger: 'default' }
      }
    ]
  })
  const updateChainResult = simulateAgentEditProposal(source, updateChain)
  assert.equal(updateChainResult.success, true, updateChainResult.errors.join('\n'))
  assert.equal(updateChainResult.workspace.executionChains[0].enabled, false)
  assert.equal(updateChainResult.workspace.executionChains[0].trigger, 'default')
  assert.equal(updateChainResult.workspace.executionChains[0].description, '更新后的主流程说明。')

  const updateActionChainDescription = parseProposal({
    type: 'edit_proposal',
    summary: '补充动作链说明',
    operations: [
      {
        type: 'update_chain',
        chainKind: 'actionChain',
        chainId: 'chain-1',
        patch: { description: '负责执行一组可复用的公共操作。' }
      }
    ]
  })
  const updateActionChainDescriptionResult = simulateAgentEditProposal(
    source,
    updateActionChainDescription
  )
  assert.equal(
    updateActionChainDescriptionResult.success,
    true,
    updateActionChainDescriptionResult.errors.join('\n')
  )
  assert.equal(
    updateActionChainDescriptionResult.workspace.chains[0].description,
    '负责执行一组可复用的公共操作。'
  )

  assert.throws(
    () =>
      parseProposal({
        type: 'edit_proposal',
        summary: '越权修改动作链设置',
        operations: [
          {
            type: 'update_chain',
            chainKind: 'actionChain',
            chainId: 'chain-1',
            patch: { enabled: true }
          }
        ]
      }),
    /动作链只能修改功能说明/
  )

  assert.throws(
    () =>
      parseProposal({
        type: 'edit_proposal',
        summary: '创建带越权字段的等待节点',
        operations: [
          {
            type: 'create_node',
            chainKind: 'actionChain',
            chainId: 'chain-1',
            node: {
              type: 'wait',
              data: { type: 'wait', params: { aiPrompt: '等待节点没有这个字段' } }
            }
          }
        ]
      }),
    /不是“等待”节点的用户可编辑字段/
  )

  assert.throws(
    () =>
      parseProposal({
        type: 'edit_proposal',
        summary: '创建节点时自定义系统名称',
        operations: [
          {
            type: 'create_node',
            chainKind: 'actionChain',
            chainId: 'chain-1',
            node: { type: 'wait', label: '自定义等待' }
          }
        ]
      }),
    /未授权字段：label/
  )

  assert.throws(
    () =>
      parseProposal({
        type: 'edit_proposal',
        summary: '创建用户界面不支持的触发链',
        operations: [
          {
            type: 'create_chain',
            chainKind: 'executionChain',
            chain: { name: '红点触发链', trigger: 'red_dot' }
          }
        ]
      }),
    /执行链触发方式只能是 manual 或 default/
  )

  const randomBranchWorkspace = workspaceFixture()
  randomBranchWorkspace.chains[0].nodes = [
    {
      id: 'node-2',
      type: 'random_branch',
      position: { x: 100, y: 100 },
      data: { type: 'random_branch' }
    },
    {
      id: 'node-3',
      type: 'wait',
      position: { x: 320, y: 100 },
      data: { type: 'wait', params: { waitMs: 500 } }
    }
  ]
  randomBranchWorkspace.chains[0].edges = [
    { id: 'edge-1', source: 'node-2', target: 'node-3', probabilityWeight: 1 }
  ]
  const updateBranchWeight = parseProposal({
    type: 'edit_proposal',
    summary: '调整随机分支权重',
    operations: [
      {
        type: 'update_edge',
        chainKind: 'actionChain',
        chainId: 'chain-1',
        edgeId: 'edge-1',
        patch: { probabilityWeight: 3 }
      }
    ]
  })
  const updateBranchResult = simulateAgentEditProposal(randomBranchWorkspace, updateBranchWeight)
  assert.equal(updateBranchResult.success, true, updateBranchResult.errors.join('\n'))
  assert.equal(updateBranchResult.workspace.chains[0].edges[0].probabilityWeight, 3)

  assert.throws(
    () =>
      parseProposal({
        type: 'edit_proposal',
        summary: '越权直接改写连线端点',
        operations: [
          {
            type: 'update_edge',
            chainKind: 'actionChain',
            chainId: 'chain-1',
            edgeId: 'edge-1',
            patch: { target: 'node-1' }
          }
        ]
      }),
    /未授权字段：target/
  )

  const renameChain = parseProposal({
    type: 'edit_proposal',
    summary: '重命名动作链',
    operations: [
      {
        type: 'rename_chain',
        chainKind: 'actionChain',
        chainId: 'chain-1',
        name: '公共动作新版'
      }
    ]
  })
  const callerWorkspace = workspaceFixture()
  callerWorkspace.executionChains[0].nodes[0] = {
    id: 'node-1',
    type: 'call_chain',
    position: { x: 100, y: 100 },
    data: { type: 'call_chain', params: { callChainName: '公共动作' } }
  }
  const renameResult = simulateAgentEditProposal(callerWorkspace, renameChain)
  assert.equal(renameResult.success, true)
  assert.equal(
    renameResult.workspace.executionChains[0].nodes[0].data.params?.callChainName,
    '公共动作新版'
  )

  const unknownRegion = parseProposal({
    type: 'edit_proposal',
    summary: '引用不存在的区域',
    operations: [
      {
        type: 'create_node',
        chainKind: 'executionChain',
        chainId: 'exec-1',
        node: { type: 'click', data: { type: 'click', region: '不存在的区域' } }
      }
    ]
  })
  assert.equal(simulateAgentEditProposal(source, unknownRegion).success, false)

  assert.throws(
    () =>
      parseProposal({
        type: 'edit_proposal',
        summary: '越权创建区域',
        operations: [{ type: 'create_region', name: '危险区域' }]
      }),
    /不支持的编辑操作/
  )
  assert.throws(
    () =>
      parseProposal({
        type: 'edit_proposal',
        summary: '注入旧版嵌套步骤',
        operations: [
          {
            type: 'create_node',
            chainKind: 'executionChain',
            chainId: 'exec-1',
            node: {
              type: 'wait',
              data: { type: 'wait', trueSteps: [{ type: 'click' }] }
            }
          }
        ]
      }),
    /未授权字段/
  )

  const deleteReferencedChain = parseProposal({
    type: 'edit_proposal',
    summary: '删除仍被引用的动作链',
    operations: [
      {
        type: 'delete_chain',
        chainKind: 'actionChain',
        chainId: 'chain-1'
      }
    ]
  })
  assert.equal(simulateAgentEditProposal(callerWorkspace, deleteReferencedChain).success, false)

  const normalizedModelShorthand = parseProposal({
    type: 'edit_proposal',
    summary: '规范化兼容模型常见的节点字段写法',
    operations: [
      {
        type: 'create_node',
        chainKind: 'executionChain',
        chainId: 'exec-1',
        node: {
          ref: 'analyze-board',
          type: 'screenshot_to_ai',
          data: {
            type: 'screenshot_to_ai',
            region: '输入框',
            params: {
              variableName: 'aiMovePlan',
              outputMode: 'action_plan',
              outputSchema: 'AIActionPlan'
            }
          }
        }
      },
      {
        type: 'create_node',
        chainKind: 'executionChain',
        chainId: 'exec-1',
        node: {
          ref: 'changed',
          type: 'if_else',
          data: {
            type: 'if_else',
            params: { condition: '输入框_changed == true' }
          }
        }
      },
      {
        type: 'create_node',
        chainKind: 'executionChain',
        chainId: 'exec-1',
        node: {
          ref: 'detect-change',
          type: 'detect_pixel_change',
          data: {
            type: 'detect_pixel_change',
            region: '输入框',
            params: { timeoutMs: 30000 }
          }
        }
      }
    ]
  })
  const normalizedScreenshotOperation = normalizedModelShorthand.operations[0]
  assert.equal(normalizedScreenshotOperation.type, 'create_node')
  if (normalizedScreenshotOperation.type === 'create_node') {
    assert.equal(normalizedScreenshotOperation.node.data?.params?.outputSchema, undefined)
  }
  const normalizedConditionOperation = normalizedModelShorthand.operations[1]
  assert.equal(normalizedConditionOperation.type, 'create_node')
  if (normalizedConditionOperation.type === 'create_node') {
    assert.deepEqual(normalizedConditionOperation.node.data?.condition, {
      variable: '输入框_changed',
      operator: 'is_true',
      value: ''
    })
  }
  const normalizedTimeoutOperation = normalizedModelShorthand.operations[2]
  assert.equal(normalizedTimeoutOperation.type, 'create_node')
  if (normalizedTimeoutOperation.type === 'create_node') {
    assert.equal(normalizedTimeoutOperation.node.data?.timeoutMs, 30000)
    assert.equal(normalizedTimeoutOperation.node.data?.params?.timeoutMs, undefined)
  }
  assert.equal(
    simulateAgentEditProposal(source, normalizedModelShorthand).success,
    true,
    '规范化后的提案必须通过确定性画布校验'
  )

  const orchestrationContext: AgentContextSnapshot = {
    projectId: 'project-1',
    projectName: '测试智能体',
    workspace: source,
    workspaceRevision: 9,
    activeChainKind: 'actionChain',
    activeChainId: 'chain-1',
    selectedNodeId: 'node-2',
    canvas: { pan: { x: 0, y: 0 }, zoom: 1, width: 1200, height: 800 },
    recentRuntimeLogs: ['节点 node-2 已完成']
  }
  assert.deepEqual(selectAgentAssistantSpecialists('你好', orchestrationContext, false), [])
  assert.deepEqual(
    selectAgentAssistantSpecialists(
      '能读取当前程序里面的棋盘区域和主窗口截图吗？',
      orchestrationContext,
      true
    ),
    []
  )
  assert.equal(isAgentAssistantContinuation('继续刚才没有完成的工作'), true)
  assert.equal(isAgentAssistantContinuation('请重新解释当前节点数量'), false)
  assert.deepEqual(
    planAgentAssistantOrchestration(
      '能读取当前程序里面的棋盘区域和主窗口截图吗？',
      orchestrationContext,
      true
    ),
    { mode: 'direct', roles: [], reviewRequired: false }
  )
  assert.deepEqual(
    planAgentAssistantOrchestration('这个问题修复了吗？', orchestrationContext, false),
    { mode: 'direct', roles: [], reviewRequired: false },
    '询问修改状态不能被误判成执行编辑'
  )
  assert.deepEqual(
    planAgentAssistantOrchestration('为什么当前执行会失败？', orchestrationContext, false),
    {
      mode: 'diagnostic',
      roles: ['workflow_engineer', 'runtime_diagnostician'],
      reviewRequired: true
    }
  )
  assert.deepEqual(
    selectAgentAssistantSpecialists('请查看截图并诊断运行错误', orchestrationContext, true),
    ['workflow_engineer', 'runtime_diagnostician', 'visual_inspector']
  )
  assert.deepEqual(
    planAgentAssistantOrchestration('仔细检查当前动作链的节点和连线', orchestrationContext, false),
    {
      mode: 'focused',
      roles: ['workflow_engineer'],
      reviewRequired: false
    }
  )
  assert.equal(
    parseAgentAssistantSpecialistReport(
      '{"summary":"已理解项目","facts":["存在一条动作链"],"evidence":["chain-1"],"risks":[],"recommendations":[],"unknowns":[],"confidence":0.9}',
      'project_architect'
    ).confidence,
    0.9
  )
  assert.equal(
    parseAgentAssistantReview('{"verdict":"pass","issues":[],"instructions":"","confidence":0.95}')
      .verdict,
    'pass'
  )

  const directActors: AgentAssistantActor[] = []
  const directResult = await orchestrateAgentAssistant(
    {
      request: '能读取当前程序里面的棋盘区域和主窗口截图吗？',
      context: orchestrationContext,
      history: [],
      hasImages: true
    },
    {
      callModel: async (modelRequest) => {
        directActors.push(modelRequest.actor)
        assert.equal(modelRequest.actor, 'manager')
        assert.equal(modelRequest.includeImages, true)
        return {
          text: JSON.stringify({
            type: 'answer',
            content: '可以，我能读取本轮附带的棋盘区域和主窗口截图。'
          })
        }
      }
    }
  )
  assert.equal(directResult.type, 'answer')
  assert.deepEqual(directActors, ['manager'], '简单问题只能由主智能体直接回答一次')

  let transientManagerCalls = 0
  const retryStages: string[] = []
  const retryResult = await orchestrateAgentAssistant(
    {
      request: '当前动作链有几个节点？',
      context: orchestrationContext,
      history: [],
      hasImages: false
    },
    {
      callModel: async () => {
        transientManagerCalls += 1
        if (transientManagerCalls === 1) throw new Error('AI API 单次模型请求超时 (300s)')
        return {
          text: JSON.stringify({ type: 'answer', content: '当前动作链有一个节点。' })
        }
      },
      onStage: (stage) => retryStages.push(stage)
    }
  )
  assert.equal(retryResult.type, 'answer')
  assert.equal(transientManagerCalls, 2, '临时模型请求失败后应继续当前助手任务')
  assert.ok(retryStages.includes('thinking'))

  let abortedManagerCalls = 0
  await assert.rejects(
    orchestrateAgentAssistant(
      {
        request: '当前动作链有几个节点？',
        context: orchestrationContext,
        history: [],
        hasImages: false
      },
      {
        callModel: async () => {
          abortedManagerCalls += 1
          const error = new Error('AI 请求已取消')
          error.name = 'AbortError'
          throw error
        }
      }
    ),
    /AI 请求已取消/
  )
  assert.equal(abortedManagerCalls, 1, '用户主动停止后不能自动重试')

  const focusedActors: AgentAssistantActor[] = []
  let focusedCheckpoint: AgentAssistantCollaborationContext | undefined
  const focusedResult = await orchestrateAgentAssistant(
    {
      request: '仔细检查当前动作链的节点和连线',
      context: orchestrationContext,
      history: [],
      hasImages: false
    },
    {
      callModel: async (modelRequest) => {
        focusedActors.push(modelRequest.actor)
        if (modelRequest.actor === 'workflow_engineer') {
          return {
            text: JSON.stringify({
              summary: '节点存在但没有连线',
              facts: ['动作链包含一个等待节点'],
              evidence: ['chain-1 / node-2'],
              risks: [],
              recommendations: [],
              unknowns: [],
              confidence: 0.9
            })
          }
        }
        assert.equal(modelRequest.actor, 'manager')
        return {
          text: JSON.stringify({ type: 'answer', content: '动作链目前有一个等待节点。' })
        }
      },
      onCheckpoint: (checkpoint) => {
        focusedCheckpoint = checkpoint
      }
    }
  )
  assert.equal(focusedResult.type, 'answer')
  assert.deepEqual(
    focusedActors,
    ['workflow_engineer', 'manager'],
    '定向检查只调用相关专家，不调用独立复核员'
  )
  assert.ok(focusedCheckpoint)
  assert.equal(focusedCheckpoint.specialistReports[0].role, 'workflow_engineer')

  const resumedActors: AgentAssistantActor[] = []
  const resumedResult = await orchestrateAgentAssistant(
    {
      request: '继续刚才的检查',
      context: orchestrationContext,
      history: [],
      hasImages: false,
      resume: {
        request: '仔细检查当前动作链的节点和连线',
        collaboration: focusedCheckpoint
      }
    },
    {
      callModel: async (modelRequest) => {
        resumedActors.push(modelRequest.actor)
        assert.equal(modelRequest.actor, 'manager')
        assert.match(modelRequest.userPrompt, /workflow_engineer/)
        return {
          text: JSON.stringify({ type: 'answer', content: '继续检查后，结论保持不变。' })
        }
      }
    }
  )
  assert.equal(resumedResult.type, 'answer')
  assert.deepEqual(resumedActors, ['manager'], '继续任务应复用已保存的专家报告')

  const actors: AgentAssistantActor[] = []
  const stages: string[] = []
  let managerCalls = 0
  let reviewerCalls = 0
  const orchestrationResult = await orchestrateAgentAssistant(
    {
      request: '把动作链公共动作的等待时间改为 1500 毫秒',
      context: orchestrationContext,
      history: [],
      hasImages: false
    },
    {
      callModel: async (modelRequest: AgentAssistantModelRequest) => {
        actors.push(modelRequest.actor)
        if (
          modelRequest.actor === 'project_architect' ||
          modelRequest.actor === 'workflow_engineer'
        ) {
          return {
            text: JSON.stringify({
              summary: '目标和节点已经确认',
              facts: ['动作链 chain-1 包含等待节点 node-2'],
              evidence: ['Workspace'],
              risks: [],
              recommendations: ['只修改 waitMs'],
              unknowns: [],
              confidence: 0.9
            })
          }
        }
        if (modelRequest.actor === 'manager') {
          managerCalls += 1
          assert.match(modelRequest.userPrompt, /specialistReports/)
          if (managerCalls === 2) {
            assert.match(modelRequest.userPrompt, /missing-node/)
            assert.match(modelRequest.userPrompt, /找不到节点/)
          }
          return {
            text: JSON.stringify({
              type: 'edit_proposal',
              content: '修改等待时间',
              summary: '修改等待时间',
              operations: [
                {
                  type: 'update_node',
                  chainKind: 'actionChain',
                  chainId: 'chain-1',
                  nodeId: managerCalls === 1 ? 'missing-node' : 'node-2',
                  patch: { data: { params: { waitMs: 1500 } } }
                }
              ]
            })
          }
        }
        reviewerCalls += 1
        if (reviewerCalls === 1) {
          assert.match(modelRequest.userPrompt, /"success": false/)
        }
        return {
          text: JSON.stringify({
            verdict: 'pass',
            issues: [],
            instructions: '',
            confidence: 0.95
          })
        }
      },
      onStage: (stage) => stages.push(stage)
    }
  )
  assert.equal(orchestrationResult.type, 'edit_proposal')
  assert.equal(orchestrationResult.proposal?.operations[0].type, 'update_node')
  assert.equal(managerCalls, 2, '确定性校验失败后应要求主助手修正')
  assert.equal(reviewerCalls, 2, '初稿和修正版都应经过独立复核')
  assert.equal(actors.filter((actor) => actor === 'project_architect').length, 0)
  assert.equal(actors.filter((actor) => actor === 'workflow_engineer').length, 1)
  assert.ok(stages.includes('revising'))

  console.log('agent-assistant tests passed')
}

void run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
