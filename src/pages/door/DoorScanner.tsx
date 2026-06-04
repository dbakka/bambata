import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import jsQR from 'jsqr'

interface ScanResult {
  passId: string
  partyId: string
  attendeeName: string
  status: 'success' | 'error'
  message: string
  timestamp: number
}

export default function DoorScanner() {
  const { partyId } = useParams<{ partyId: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const animRef = useRef<number>(0)
  const lastScanRef = useRef<string>('')
  const lastScanTimeRef = useRef<number>(0)

  const [creatorToken, setCreatorToken] = useState('')
  const [scanning, setScanning] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [lastResult, setLastResult] = useState<ScanResult | null>(null)
  const [recentScans, setRecentScans] = useState<ScanResult[]>([])
  const [partyName, setPartyName] = useState('')

  useEffect(() => {
    if (!partyId) return

    // Get creator token from localStorage or URL param
    const storedToken = localStorage.getItem(`bambata_creator_${partyId}`)
    const urlToken = searchParams.get('token')
    const token = storedToken ?? urlToken ?? ''
    setCreatorToken(token)

    if (!token) {
      navigate('/')
      return
    }

    fetch(`/api/parties/${partyId}`, { headers: { 'x-creator-token': token } })
      .then((r) => r.json())
      .then((p: { name: string }) => setPartyName(p.name))
      .catch(() => {})
  }, [partyId, searchParams, navigate])

  const processQR = useCallback(
    async (data: string) => {
      const now = Date.now()
      // Debounce: same QR within 3 seconds
      if (data === lastScanRef.current && now - lastScanTimeRef.current < 3000) return
      lastScanRef.current = data
      lastScanTimeRef.current = now

      let passId: string | null = null
      let scanPartyId: string | null = null

      try {
        const parsed = JSON.parse(data) as { passId: string; partyId: string }
        passId = parsed.passId
        scanPartyId = parsed.partyId
      } catch {
        const result: ScanResult = {
          passId: '',
          partyId: '',
          attendeeName: '',
          status: 'error',
          message: 'Invalid QR code',
          timestamp: now,
        }
        setLastResult(result)
        return
      }

      if (scanPartyId !== partyId) {
        const result: ScanResult = {
          passId: passId ?? '',
          partyId: scanPartyId ?? '',
          attendeeName: '',
          status: 'error',
          message: 'Pass for a different party',
          timestamp: now,
        }
        setLastResult(result)
        return
      }

      try {
        const res = await fetch(`/api/passes/${passId}/scan`, {
          method: 'POST',
          headers: { 'x-creator-token': creatorToken },
        })
        const responseData = (await res.json()) as {
          attendee_name?: string
          partyName?: string
          error?: string
        }

        if (!res.ok) {
          const result: ScanResult = {
            passId: passId ?? '',
            partyId: scanPartyId ?? '',
            attendeeName: '',
            status: 'error',
            message: responseData.error ?? 'Scan failed',
            timestamp: now,
          }
          setLastResult(result)
          setRecentScans((prev) => [result, ...prev.slice(0, 9)])
        } else {
          const result: ScanResult = {
            passId: passId ?? '',
            partyId: scanPartyId ?? '',
            attendeeName: responseData.attendee_name ?? '',
            status: 'success',
            message: `Welcome in, ${responseData.attendee_name ?? 'Guest'}!`,
            timestamp: now,
          }
          setLastResult(result)
          setRecentScans((prev) => [result, ...prev.slice(0, 9)])
        }
      } catch {
        const result: ScanResult = {
          passId: passId ?? '',
          partyId: scanPartyId ?? '',
          attendeeName: '',
          status: 'error',
          message: 'Network error',
          timestamp: now,
        }
        setLastResult(result)
      }
    },
    [partyId, creatorToken],
  )

  const startScanning = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const scan = () => {
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const code = jsQR(imageData.data, imageData.width, imageData.height)
        if (code) {
          processQR(code.data)
        }
      }
      animRef.current = requestAnimationFrame(scan)
    }
    animRef.current = requestAnimationFrame(scan)
  }, [processQR])

  const openCamera = useCallback(async () => {
    setCameraError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      })
      streamRef.current = stream
      const video = videoRef.current
      if (video) {
        video.srcObject = stream
        video.play()
        video.onloadedmetadata = () => {
          setScanning(true)
          startScanning()
        }
      }
    } catch (err) {
      setCameraError(err instanceof Error ? err.message : 'Camera access denied')
    }
  }, [startScanning])

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(animRef.current)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    setScanning(false)
  }, [])

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current)
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
      }
    }
  }, [])

  const [showFlash, setShowFlash] = useState(false)

  useEffect(() => {
    if (!lastResult) return
    setShowFlash(true)
    const t = setTimeout(() => setShowFlash(false), 3000)
    return () => clearTimeout(t)
  }, [lastResult])

  const isSuccess = lastResult?.status === 'success'

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: '#050508' }}
    >
      {/* Header */}
      <div
        className="px-4 py-3 flex items-center justify-between"
        style={{ borderBottom: '1px solid #1e1e2e' }}
      >
        <div>
          <span className="text-xs font-mono" style={{ color: '#00d2ff' }}>
            DOOR SCANNER
          </span>
          {partyName && (
            <div className="text-xs font-mono mt-0.5" style={{ color: '#475569' }}>
              {partyName}
            </div>
          )}
        </div>
        <button
          onClick={() => navigate(`/creator/${partyId}`)}
          className="text-xs font-mono flex items-center gap-1.5 px-3 py-1.5 rounded-xl"
          style={{ background: '#0f0f17', border: '1px solid #1e1e2e', color: '#475569' }}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          BACK
        </button>
      </div>

      {/* Camera view */}
      <div className="relative flex-1 flex flex-col items-center justify-center p-4">
        <div
          className="relative w-full max-w-sm aspect-square rounded-2xl overflow-hidden"
          style={{ background: '#0f0f17', border: '1px solid #1e1e2e' }}
        >
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-cover"
            playsInline
            muted
          />
          <canvas ref={canvasRef} className="hidden" />

          {!scanning && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
              {cameraError ? (
                <div className="text-center px-6">
                  <p className="text-xs font-mono mb-2" style={{ color: '#ef4444' }}>
                    {cameraError}
                  </p>
                </div>
              ) : (
                <div className="text-center">
                  <svg className="w-12 h-12 mx-auto mb-3" style={{ color: '#1e1e2e' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
              )}
              <button
                onClick={openCamera}
                className="px-6 py-3 rounded-xl font-bold text-sm tracking-wider"
                style={{
                  background: 'rgba(0, 210, 255, 0.15)',
                  border: '1px solid rgba(0, 210, 255, 0.4)',
                  color: '#00d2ff',
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              >
                START CAMERA
              </button>
            </div>
          )}

          {/* Scan overlay */}
          {scanning && (
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute inset-8 border-2 rounded-lg" style={{ borderColor: 'rgba(0, 210, 255, 0.4)' }}>
                <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 rounded-tl" style={{ borderColor: '#00d2ff' }} />
                <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 rounded-tr" style={{ borderColor: '#00d2ff' }} />
                <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 rounded-bl" style={{ borderColor: '#00d2ff' }} />
                <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 rounded-br" style={{ borderColor: '#00d2ff' }} />
              </div>
            </div>
          )}

          {/* Result flash */}
          {lastResult && showFlash && (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl"
              style={{
                background: isSuccess ? 'rgba(34, 197, 94, 0.9)' : 'rgba(239, 68, 68, 0.9)',
              }}
            >
              <div className="text-center">
                <p className="text-5xl font-black mb-3">
                  {isSuccess ? '✓' : '✗'}
                </p>
                <p className="text-xl font-bold text-white">
                  {isSuccess ? 'WELCOME IN' : 'INVALID PASS'}
                </p>
                {lastResult.attendeeName && (
                  <p className="text-lg text-white mt-1 opacity-90">
                    {lastResult.attendeeName}
                  </p>
                )}
                {!isSuccess && (
                  <p className="text-sm text-white mt-2 opacity-80">
                    {lastResult.message}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {scanning && (
          <button
            onClick={stopCamera}
            className="mt-4 text-xs font-mono"
            style={{ color: '#475569' }}
          >
            STOP CAMERA
          </button>
        )}

        {/* Recent scans */}
        {recentScans.length > 0 && (
          <div className="w-full max-w-sm mt-6">
            <h3 className="text-xs font-mono font-bold tracking-wider mb-3" style={{ color: '#475569' }}>
              RECENT SCANS
            </h3>
            <div className="space-y-2">
              {recentScans.map((scan) => (
                <div
                  key={scan.timestamp}
                  className="flex items-center justify-between px-3 py-2 rounded-xl"
                  style={{ background: '#0f0f17', border: '1px solid #1e1e2e' }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="text-xs"
                      style={{ color: scan.status === 'success' ? '#22c55e' : '#ef4444' }}
                    >
                      {scan.status === 'success' ? '✓' : '✗'}
                    </span>
                    <span className="text-sm" style={{ color: '#e2e8f0' }}>
                      {scan.attendeeName || scan.message}
                    </span>
                  </div>
                  <span className="text-xs font-mono" style={{ color: '#475569' }}>
                    {new Date(scan.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
