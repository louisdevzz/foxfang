import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { Sparkles, ArrowRight, AlertCircle } from 'lucide-react'

export default function Login() {
  const [token, setToken] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [isAutoLoggingIn, setIsAutoLoggingIn] = useState(false)
  const { login } = useAuth()

  // Check for token in URL on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const urlToken = urlParams.get('token')
    
    if (urlToken) {
      setToken(urlToken)
      setIsAutoLoggingIn(true)
      // Auto-login with the token from URL
      login(urlToken).then((success) => {
        if (!success) {
          setError('Invalid token from URL. Please check and try again.')
          setIsAutoLoggingIn(false)
        }
      }).catch(() => {
        setError('Failed to login with URL token.')
        setIsAutoLoggingIn(false)
      })
    }
  }, [login])
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')
    
    const success = await login(token)
    
    if (!success) {
      setError('Invalid token. Please check your token and try again.')
    }
    
    setIsLoading(false)
  }

  if (isAutoLoggingIn) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-bg-primary bg-[radial-gradient(circle_at_50%_0%,var(--color-fox-secondary)_0%,transparent_50%)]">
        <div className="w-full max-w-md bg-bg-secondary border border-border-default rounded-xl p-12 shadow-lg">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-6 rounded-xl flex items-center justify-center bg-gradient-to-br from-fox-primary to-fox-primary-hover">
              <Sparkles className="w-8 h-8 text-white" />
            </div>
            
            <h1 className="text-2xl font-bold text-text-primary mb-4">FoxFang</h1>
            
            <div className="flex flex-col items-center gap-4">
              <div className="w-8 h-8 border-3 border-bg-tertiary border-t-fox-primary rounded-full animate-spin" />
              <p className="text-text-secondary">Logging in...</p>
            </div>
          </div>
        </div>
      </div>
    )
  }
  
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-bg-primary bg-[radial-gradient(circle_at_50%_0%,var(--color-fox-secondary)_0%,transparent_50%)]">
      <div className="w-full max-w-md bg-bg-secondary border border-border-default rounded-xl p-12 shadow-lg">
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-6 rounded-xl flex items-center justify-center bg-gradient-to-br from-fox-primary to-fox-primary-hover">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          
          <h1 className="text-2xl font-bold text-text-primary mb-1">FoxFang</h1>
          <p className="text-text-secondary text-base">AI Marketing Platform</p>
        </div>
        
        {error && (
          <div className="flex items-center gap-3 p-4 mb-6 bg-danger/10 border border-danger rounded-lg text-danger-text text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
        
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <label htmlFor="token" className="text-sm font-medium text-text-primary">Access Token</label>
            <input
              type="password"
              id="token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Enter your access token"
              required
              disabled={isLoading}
              className="px-4 py-3 bg-bg-primary border border-border-default rounded-lg text-text-primary text-base transition-all duration-fast focus:outline-none focus:border-fox-primary focus:ring-2 focus:ring-fox-primary/10 disabled:opacity-60 placeholder:text-text-muted"
            />
            <p className="text-xs text-text-muted mt-1">Token configured in gateway setup</p>
          </div>
          
          <button 
            type="submit" 
            disabled={isLoading}
            className="flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-br from-fox-primary to-fox-primary-hover text-white text-base font-semibold rounded-lg cursor-pointer transition-all duration-fast hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(233,69,96,0.3)] active:translate-y-0 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Connecting...
              </span>
            ) : (
              <>
                Connect
                <ArrowRight className="w-5 h-5" />
              </>
            )}
          </button>
        </form>
        
        <div className="mt-8 pt-6 border-t border-border-muted text-center">
          <p className="text-sm text-text-secondary">
            Run{' '}
            <code className="px-1.5 py-0.5 bg-bg-tertiary rounded text-xs">pnpm foxfang daemon run</code>
            {' '}to get the auto-login link
          </p>
        </div>
      </div>
    </div>
  )
}
