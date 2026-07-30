import { forwardRef, useImperativeHandle, useEffect, useRef, useState } from 'react'
import type { Region, StepParams, WindowAnchor } from '../../../../../core/action-chain/types'
import { inputStyle, labelStyle } from '../../styles'
import { Section } from '../Section'
import { Field } from '../Field'
import { absoluteRegionRect, type EditRegionFn } from '../shared'
import type { StepFormHandle, StepFormProps } from './SimpleForms'

interface LocateUiRegionFormProps extends StepFormProps {
  region: string
  regions: Region[]
  regionNames: string[]
  windowAnchors: WindowAnchor[]
  onEditRegion?: EditRegionFn
}

export const LocateUiRegionForm = forwardRef<StepFormHandle, LocateUiRegionFormProps>(
  function LocateUiRegionForm(
    { markDirty, params, region, regions, regionNames, windowAnchors, onEditRegion },
    ref
  ) {
    const [uiLocateMode, setUiLocateMode] = useState<'template' | 'relative'>(
      params?.uiLocateMode ?? 'template'
    )
    const initialSearchWindowAnchorId =
      regions.find((item) => item.name === region)?.windowAnchorId ?? windowAnchors[0]?.id ?? ''
    const [uiSearchScope, setUiSearchScope] = useState<'nearby' | 'window' | 'region'>(
      params?.uiSearchScope ?? (params?.uiSearchRegion ? 'region' : 'nearby')
    )
    const [uiSearchWindowAnchorId, setUiSearchWindowAnchorId] = useState(
      params?.uiSearchWindowAnchorId ?? initialSearchWindowAnchorId
    )
    const [uiReferenceRegion, setUiReferenceRegion] = useState(params?.uiReferenceRegion ?? '')
    const [uiSearchRegion, setUiSearchRegion] = useState(params?.uiSearchRegion ?? '')
    const [uiSearchPadding, setUiSearchPadding] = useState(String(params?.uiSearchPadding ?? 120))
    const [uiMatchThreshold, setUiMatchThreshold] = useState(
      String(params?.uiMatchThreshold ?? 0.82)
    )
    const initialTargetRect = absoluteRegionRect(
      regions.find((item) => item.name === region),
      windowAnchors
    )
    const initialReferenceRect = absoluteRegionRect(
      regions.find((item) => item.name === params?.uiReferenceRegion),
      windowAnchors
    )
    const [uiOffsetX, setUiOffsetX] = useState(
      String(
        params?.uiOffsetX ??
          (initialTargetRect && initialReferenceRect
            ? initialTargetRect.x - initialReferenceRect.x
            : 0)
      )
    )
    const [uiOffsetY, setUiOffsetY] = useState(
      String(
        params?.uiOffsetY ??
          (initialTargetRect && initialReferenceRect
            ? initialTargetRect.y - initialReferenceRect.y
            : 0)
      )
    )

    function updateRelativeOffsets(targetName: string, referenceName: string): void {
      const targetRect = absoluteRegionRect(
        regions.find((item) => item.name === targetName),
        windowAnchors
      )
      const referenceRect = absoluteRegionRect(
        regions.find((item) => item.name === referenceName),
        windowAnchors
      )
      if (!targetRect || !referenceRect) return
      setUiOffsetX(String(targetRect.x - referenceRect.x))
      setUiOffsetY(String(targetRect.y - referenceRect.y))
    }

    // region 变化时联动：更新窗口锚点和偏移量
    const prevRegionRef = useRef(region)
    useEffect(() => {
      if (prevRegionRef.current === region) return
      prevRegionRef.current = region
      const targetAnchorId = regions.find((item) => item.name === region)?.windowAnchorId
      if (targetAnchorId) setUiSearchWindowAnchorId(targetAnchorId)
      updateRelativeOffsets(region, uiReferenceRegion)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [region])

    useImperativeHandle(ref, () => ({
      collectParams: () => {
        const result: Partial<StepParams> = {}
        result.uiLocateMode = uiLocateMode
        if (uiLocateMode === 'template') {
          result.uiSearchScope = uiSearchScope
          if (uiSearchScope === 'region') result.uiSearchRegion = uiSearchRegion || undefined
          if (uiSearchScope === 'window') {
            result.uiSearchWindowAnchorId = uiSearchWindowAnchorId || undefined
          }
          const padding = Number(uiSearchPadding)
          const threshold = Number(uiMatchThreshold)
          if (uiSearchScope === 'nearby' && Number.isFinite(padding) && padding >= 0) {
            result.uiSearchPadding = padding
          }
          if (Number.isFinite(threshold) && threshold > 0 && threshold <= 1) {
            result.uiMatchThreshold = threshold
          }
        } else {
          result.uiReferenceRegion = uiReferenceRegion || undefined
          const offsetX = Number(uiOffsetX)
          const offsetY = Number(uiOffsetY)
          if (Number.isFinite(offsetX)) result.uiOffsetX = offsetX
          if (Number.isFinite(offsetY)) result.uiOffsetY = offsetY
        }
        return result
      }
    }))

    return (
      <Section title="UI区域定位">
        <div style={labelStyle}>定位方式</div>
        <select
          value={uiLocateMode}
          onChange={(event) => {
            setUiLocateMode(event.target.value as 'template' | 'relative')
            markDirty()
          }}
          style={inputStyle}
        >
          <option value="template">图片模板匹配</option>
          <option value="relative">相对另一个区域</option>
        </select>

        {uiLocateMode === 'template' ? (
          <>
            <div style={{ color: '#737b8c', fontSize: 11, lineHeight: 1.5, marginTop: 8 }}>
              {regions.find((item) => item.name === region)?.templateImagePath
                ? '该区域已有框选模板图片。'
                : '该区域还没有模板图片，请重新打开框选界面并点击完成。'}
            </div>
            <div style={{ ...labelStyle, marginTop: 10 }}>搜索范围</div>
            <select
              value={uiSearchScope}
              onChange={(event) => {
                setUiSearchScope(event.target.value as 'nearby' | 'window' | 'region')
                markDirty()
              }}
              style={inputStyle}
            >
              <option value="nearby">目标原位置附近</option>
              <option value="window">整个锚点窗口</option>
              <option value="region">指定框选区域</option>
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
                <div style={labelStyle}>限制搜索区域</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <select
                    value={uiSearchRegion}
                    onChange={(event) => {
                      setUiSearchRegion(event.target.value)
                      markDirty()
                    }}
                    style={{ ...inputStyle, flex: 1 }}
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
                  {onEditRegion && (
                    <button
                      onClick={async () => {
                        const r = uiSearchRegion
                          ? regions.find((item) => item.name === uiSearchRegion)
                          : null
                        const returned = r
                          ? await onEditRegion(uiSearchRegion, r.rect)
                          : await onEditRegion('', { x: 0, y: 0, width: 200, height: 200 })
                        if (returned) {
                          setUiSearchRegion(returned)
                          markDirty()
                        }
                      }}
                      style={{
                        padding: '6px 8px',
                        fontSize: 11,
                        borderRadius: 4,
                        border: '1px solid rgba(56,189,248,0.3)',
                        background: 'rgba(56,189,248,0.1)',
                        color: '#38bdf8',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {uiSearchRegion ? '编辑' : '框选'}
                    </button>
                  )}
                </div>
              </div>
            )}
            {uiSearchScope === 'nearby' && (
              <div style={{ marginTop: 10 }}>
                <Field
                  label="原位置四周搜索范围（像素）"
                  value={uiSearchPadding}
                  onChange={(v) => {
                    setUiSearchPadding(v)
                    markDirty()
                  }}
                />
              </div>
            )}
            <div style={{ marginTop: 10 }}>
              <Field
                label="最低匹配度（0-1）"
                value={uiMatchThreshold}
                onChange={(v) => {
                  setUiMatchThreshold(v)
                  markDirty()
                }}
              />
            </div>
          </>
        ) : (
          <>
            <div style={{ ...labelStyle, marginTop: 10 }}>基准区域</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select
                value={uiReferenceRegion}
                onChange={(event) => {
                  const referenceName = event.target.value
                  setUiReferenceRegion(referenceName)
                  updateRelativeOffsets(region, referenceName)
                  markDirty()
                }}
                style={{ ...inputStyle, flex: 1 }}
              >
                <option value="">选择基准区域</option>
                {regionNames
                  .filter((name) => name !== region)
                  .map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
              </select>
              {onEditRegion && (
                <button
                  onClick={async () => {
                    const r = uiReferenceRegion
                      ? regions.find((item) => item.name === uiReferenceRegion)
                      : null
                    const returned = r
                      ? await onEditRegion(uiReferenceRegion, r.rect)
                      : await onEditRegion('', { x: 0, y: 0, width: 200, height: 200 })
                    if (returned) {
                      setUiReferenceRegion(returned)
                      markDirty()
                    }
                  }}
                  style={{
                    padding: '6px 8px',
                    fontSize: 11,
                    borderRadius: 4,
                    border: '1px solid rgba(56,189,248,0.3)',
                    background: 'rgba(56,189,248,0.1)',
                    color: '#38bdf8',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {uiReferenceRegion ? '编辑' : '框选'}
                </button>
              )}
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 8,
                marginTop: 10
              }}
            >
              <Field
                label="横向偏移 X"
                value={uiOffsetX}
                onChange={(v) => {
                  setUiOffsetX(v)
                  markDirty()
                }}
              />
              <Field
                label="纵向偏移 Y"
                value={uiOffsetY}
                onChange={(v) => {
                  setUiOffsetY(v)
                  markDirty()
                }}
              />
            </div>
            <div style={{ color: '#737b8c', fontSize: 11, lineHeight: 1.5, marginTop: 8 }}>
              选择基准区域后会根据框选时的位置自动计算偏移，也可以手动调整。
            </div>
          </>
        )}
      </Section>
    )
  }
)
