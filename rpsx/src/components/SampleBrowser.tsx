import React, { useEffect, useState } from 'react'
import { useBrowser, sampleBrowser } from '../store/browser'
import { rpc } from '../rpc'

interface SampleWaveformProps {
  samplePath: string;
}

function SampleWaveform({ samplePath }: SampleWaveformProps) {
  const [waveform, setWaveform] = useState<number[]>([])
  
  useEffect(() => {
    if (!samplePath) return
    
    rpc.getSampleWaveform(samplePath)
      .then(setWaveform)
      .catch(err => console.error('Failed to load waveform:', err))
  }, [samplePath])

  if (waveform.length === 0) {
    return (
      <div className="h-16 bg-gray-900 border border-gray-600 rounded mb-3 flex items-center justify-center">
        <span className="text-gray-500 text-sm">Loading waveform...</span>
      </div>
    )
  }

  const max = Math.max(...waveform.map(Math.abs))
  const normalizedWaveform = waveform.map(sample => sample / max)

  return (
    <div className="h-16 bg-gray-900 border border-gray-600 rounded mb-3 p-1">
      <svg className="w-full h-full">
        <polyline
          fill="none"
          stroke="#06b6d4"
          strokeWidth="1"
          points={normalizedWaveform
            .map((sample, i) => {
              const x = (i / (normalizedWaveform.length - 1)) * 100
              const y = 50 - (sample * 45) // Center line at 50%, scale to ±45%
              return `${x},${y}`
            })
            .join(' ')}
        />
        {/* Center line */}
        <line x1="0" y1="50%" x2="100%" y2="50%" stroke="#374151" strokeWidth="1" strokeDasharray="2,2" />
      </svg>
    </div>
  )
}

export default function SampleBrowser() {
  const { 
    sampleBrowserOpen, 
    sampleBrowserItems, 
    sampleBrowserSelected,
    isRecording 
  } = useBrowser()

  const {
    sampleBrowserMoveUp,
    sampleBrowserMoveDown,
    loadSelectedSample,
    closeSampleBrowser
  } = sampleBrowser

  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false)
  const currentSample = sampleBrowserItems[sampleBrowserSelected]

  const handlePreview = async () => {
    if (!currentSample) return
    
    try {
      if (isPreviewPlaying) {
        await rpc.stopPreview()
        setIsPreviewPlaying(false)
      } else {
        await rpc.previewSample(currentSample)
        setIsPreviewPlaying(true)
        // Auto-stop after 3 seconds
        setTimeout(() => setIsPreviewPlaying(false), 3000)
      }
    } catch (err) {
      console.error('Preview failed:', err)
      setIsPreviewPlaying(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key.toLowerCase()) {
      case 'e':
        e.preventDefault()
        sampleBrowserMoveUp()
        break
      case 'd':
        e.preventDefault()
        sampleBrowserMoveDown()
        break
      case 'q':
      case 'enter':
        e.preventDefault()
        loadSelectedSample()
        break
      case ' ': // Spacebar for preview
        e.preventDefault()
        handlePreview()
        break
      case 'z': // Z key for preview (matching typical controls)
        e.preventDefault()
        handlePreview()
        break
      case 'escape':
        e.preventDefault()
        if (isPreviewPlaying) {
          rpc.stopPreview().then(() => setIsPreviewPlaying(false))
        }
        closeSampleBrowser()
        break
    }
  }

  // Stop preview when sample selection changes
  useEffect(() => {
    if (isPreviewPlaying) {
      rpc.stopPreview().then(() => setIsPreviewPlaying(false))
    }
  }, [sampleBrowserSelected])

  // Stop preview when closing browser
  useEffect(() => {
    if (!sampleBrowserOpen && isPreviewPlaying) {
      rpc.stopPreview().then(() => setIsPreviewPlaying(false))
    }
  }, [sampleBrowserOpen])

  if (!sampleBrowserOpen) return null

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      autoFocus
    >
      <div className="bg-gray-800 border border-gray-600 rounded-lg p-4 max-w-2xl w-full mx-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Sample Browser</h2>
          {isRecording && (
            <div className="text-red-500 text-sm font-semibold animate-pulse">
              ● RECORDING
            </div>
          )}
        </div>
        
        <div className="text-sm text-gray-300 mb-3">
          Documents/subsamples • WAV, MP3, FLAC, AIFF
        </div>

        {/* Waveform Display */}
        {currentSample && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-300">{currentSample}</span>
              <button
                onClick={handlePreview}
                className={`px-3 py-1 text-xs rounded transition-colors ${
                  isPreviewPlaying 
                    ? 'bg-red-600 text-white hover:bg-red-700' 
                    : 'bg-cyan-600 text-white hover:bg-cyan-700'
                }`}
              >
                {isPreviewPlaying ? '⏹ Stop' : '▶ Preview'}
              </button>
            </div>
            <SampleWaveform samplePath={currentSample} />
          </div>
        )}
        
        <div className="max-h-60 overflow-y-auto border-2 border-gray-600 rounded bg-gray-900">
          {sampleBrowserItems.length === 0 ? (
            <div className="p-4 text-center text-gray-400">
              No samples found
            </div>
          ) : (
            sampleBrowserItems.map((item, index) => (
              <div
                key={item}
                className={`p-3 cursor-pointer text-sm border-l-4 transition-all duration-150 ${
                  index === sampleBrowserSelected
                    ? 'bg-cyan-600 text-white border-l-cyan-300 font-semibold shadow-lg'
                    : 'text-gray-300 hover:bg-gray-700 border-l-transparent hover:border-l-gray-500'
                }`}
                onClick={() => {
                  if (index === sampleBrowserSelected) {
                    loadSelectedSample()
                  } else {
                    // Update selection
                    const diff = index - sampleBrowserSelected
                    if (diff > 0) {
                      for (let i = 0; i < diff; i++) sampleBrowserMoveDown()
                    } else {
                      for (let i = 0; i < -diff; i++) sampleBrowserMoveUp()
                    }
                  }
                }}
              >
                <div className="flex items-center justify-between">
                  <span>{item}</span>
                  {index === sampleBrowserSelected && (
                    <span className="text-cyan-300 text-xs">◄ SELECTED</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
        
        <div className="mt-4 text-xs text-gray-400 space-y-1">
          <div>E/D Navigate • Q/Enter: Load Sample • Space/Z: Preview • Esc: Close</div>
          <div>Hold R: Record • Release R: Stop Recording</div>
        </div>
      </div>
    </div>
  )
}
