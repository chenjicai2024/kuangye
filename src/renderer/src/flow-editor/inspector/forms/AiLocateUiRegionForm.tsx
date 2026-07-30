import { forwardRef, useImperativeHandle, useEffect, useRef, useState } from 'react'
import type { Region, StepParams, WindowAnchor } from '../../../../../core/action-chain/types'
import { inputStyle, labelStyle } from '../../styles'
import { Section } from '../Section'
import { Field } from '../Field'
import type { StepFormHandle, StepFormProps } from './SimpleForms'

interface AiLocateUiRegionFormProps extends StepFormProps {
  region: string
  regions: Region[]
  regionNames: string[]
  windowAnchors: WindowAnchor[]
}

export const AiLocateUiRegionForm = forwardRef<StepFormHandle, AiLocateUiRegionFormProps>(
  function AiLocateUiRegionForm(
    { markDirty, params, region, regions, regionNames, windowAnchors },
    ref
  ) {
    const [uiVisionPrompt, setUiVisionPrompt] = useState(params?.uiVisionPrompt ?? '')
    const initialReferenceImageRegion = regions.find(
      (item) => item.name === region && item.templateImagePath
    )?.name
    const [uiReferenceImageRegion, setUiReferenceImageRegion] = useState(
      params?.uiReferenceImageRegion ?? initialReferenceImageRegion ?? ''
    )
    const initialSearchWindowAnchorId =
      regions.find((item) => item.name === region)?.windowAnchorId ?? windowAnchors[0]?.id ?? ''
    const [uiSearchScope, setUiSearchScope] = useState<'nearby' | 'window' | 'region'>(
      params?.uiSearchScope ?? (params?.uiSearchRegion ? 'region' : 'window')
    )
    const [uiSearchWindowAnchorId, setUiSearchWindowAnchorId] = useState(
      params?.uiSearchWindowAnchorId ?? initialSearchWindowAnchorId
    )
    const [uiSearchRegion, setUiSearchRegion] = useState(params?.uiSearchRegion ?? '')
    const [uiSearchPadding, setUiSearchPadding] = useState(String(params?.uiSearchPadding ?? 120))

    // region 变化时联动：更新窗口锚点和参考图片
    const prevRegionRef = useRef(region)
    useEffect(() => {
      if (prevRegionRef.current === region) return
      prevRegionRef.current = region
      const targetAnchorId = regions.find((item) => item.name === region)?.windowAnchorId
      if (targetAnchorId) setUiSearchWindowAnchorId(targetAnchorId)
      if (
        !uiReferenceImageRegion &&
        regions.find((item) => item.name === region)?.templateImagePath
      ) {
        setUiReferenceImageRegion(region)
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [region])

    useImperativeHandle(ref, () => ({
      collectParams: () => {
        const result: Partial<StepParams> = {}
        result.uiVisionPrompt = uiVisionPrompt.trim()
        result.uiReferenceImageRegion = uiReferenceImageRegion || undefined
        result.uiSearchScope = uiSearchScope
        if (uiSearchScope === 'region') result.uiSearchRegion = uiSearchRegion || undefined
        if (uiSearchScope === 'window') {
          result.uiSearchWindowAnchorId = uiSearchWindowAnchorId || undefined
        }
        const padding = Number(uiSearchPadding)
        if (uiSearchScope === 'nearby' && Number.isFinite(padding) && padding >= 0) {
          result.uiSearchPadding = padding
        }
        return result
      }
    }))

    return (
      <Section title="AI视觉定位">
        <div style={labelStyle}>告诉AI要寻找什么</div>
        <textarea
          value={uiVisionPrompt}
          onChange={(event) => {
            setUiVisionPrompt(event.target.value)
            markDirty()
          }}
          rows={5}
          placeholder="例如：找到聊天窗口底部用于输入消息的完整文本输入框，不包含工具栏和发送按钮"
          style={{ ...inputStyle, resize: 'vertical' }}
        />
        <div style={{ color: '#737b8c', fontSize: 11, lineHeight: 1.5, marginTop: 8 }}>
          程序会自动追加坐标返回格式，要求AI只返回目标区域；这里不需要手写JSON或坐标格式。
        </div>

        <div style={{ ...labelStyle, marginTop: 10 }}>参考图片（可选）</div>
        <select
          value={uiReferenceImageRegion}
          onChange={(event) => {
            setUiReferenceImageRegion(event.target.value)
            markDirty()
          }}
          style={inputStyle}
        >
          <option value="">不附带参考图片</option>
          {regions
            .filter((item) => Boolean(item.templateImagePath))
            .map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}的框选图片
              </option>
            ))}
        </select>
        <div style={{ color: '#737b8c', fontSize: 11, lineHeight: 1.5, marginTop: 6 }}>
          参考图片只告诉AI目标大致长什么样；AI仍然只在下面选择的查看范围中返回坐标。
        </div>

        <div style={{ ...labelStyle, marginTop: 10 }}>AI查看范围</div>
        <select
          value={uiSearchScope}
          onChange={(event) => {
            setUiSearchScope(event.target.value as 'nearby' | 'window' | 'region')
            markDirty()
          }}
          style={inputStyle}
        >
          <option value="window">整个锚点窗口</option>
          <option value="region">指定框选区域</option>
          <option value="nearby">目标原位置附近</option>
        </select>
        {uiSearchScope === 'window' && (
          <div style={{ marginTop: 10 }}>
            <div style={labelStyle}>窗口锚点</div>
            <select
              value={uiSearchWindowAnchorId}
              onChange={(event) => {
                setUiSearchWindowAnchorId(event.target.value)
                markDirty()
              }}
              style={inputStyle}
            >
              <option value="">选择窗口锚点</option>
              {windowAnchors.map((anchor) => (
                <option key={anchor.id} value={anchor.id}>
                  {anchor.name} · {anchor.ownerName || anchor.title}
                </option>
              ))}
            </select>
          </div>
        )}
        {uiSearchScope === 'region' && (
          <div style={{ marginTop: 10 }}>
            <div style={labelStyle}>限制AI查看的区域</div>
            <select
              value={uiSearchRegion}
              onChange={(event) => {
                setUiSearchRegion(event.target.value)
                markDirty()
              }}
              style={inputStyle}
            >
              <option value="">选择区域</option>
              {regionNames
                .filter((name) => name !== region)
                .map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
            </select>
          </div>
        )}
        {uiSearchScope === 'nearby' && (
          <div style={{ marginTop: 10 }}>
            <Field
              label="原位置四周查看范围（像素）"
              value={uiSearchPadding}
              onChange={(v) => {
                setUiSearchPadding(v)
                markDirty()
              }}
            />
          </div>
        )}
      </Section>
    )
  }
)
