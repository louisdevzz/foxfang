import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { Sparkles, ArrowRight, AlertCircle } from 'lucide-react'
import './Login.css'

export default function Login() {
  const [token, setToken] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [isAutoLoggingIn, setIsAutoLoggingIn] = useState(false)
  const [searchParams] = useSearchParams()
  const { login } = useAuth()

  // Check for token in URL on mount - only run once
  useEffect(() => {
    const urlToken = searchParams.get('token')
    
    if (urlToken && !isAutoLoggingIn) {
      setToken(urlToken)
      setIsAutoLoggingIn(true)
      
      // Auto-login with the token from URL
      const attemptAutoLogin = async () => {
        try {
          const success = await login(urlToken)
          if (!success) {
            setError('Invalid token from URL. Please check the URL or enter token manually.')
            setIsAutoLoggingIn(false)
          }
          // If success, the auth context will handle redirect
        } catch (err) {
          setError('Failed to connect to server. Please check if the daemon is running.')
          setIsAutoLoggingIn(false)
        }
      }
      
      attemptAutoLogin()
    }
  }, [searchParams, isAutoLoggingIn, login])
  
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
      <div className="login-page">
        <div className="login-card">
          <div className="login-auto">
            <div className="login-logo" style={{ marginBottom: '24px' }}>
              <Sparkles />
            </div>
            
            <h1 className="login-title" style={{ marginBottom: '16px' }}>FoxFang</h1>
            
            <div className="login-auto-spinner" />
            <p>Logging in...</p>
          </div>
        </div>
      </div>
    )
  }
  
  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <div className="login-logo">
            <Sparkles />
          </div>
          
          <h1 className="login-title">FoxFang</h1>
          <p className="login-subtitle">AI Marketing Platform</p>
        </div>
        
        {error && (
          <div className="login-error">
            <AlertCircle />
            <span>{error}</span>
          </div>
        )}
        
        <form onSubmit={handleSubmit} className="login-form">
          <div className="login-field">
            <label htmlFor="token" className="login-label">Access Token</label>
            <input
              type="password"
              id="token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Enter your access token"
              required
              disabled={isLoading}
              className="login-input"
            />
            <p className="login-hint">Token configured in gateway setup</p>
          </div>
          
          <button 
            type="submit" 
            disabled={isLoading}
            className="login-button"
          >
            {isLoading ? (
              <>
                <span className="login-button-spinner" />
                Connecting...
              </>
            ) : (
              <>
                Connect
                <ArrowRight style={{ width: '20px', height: '20px' }} />
              </>
            )}
          </button>
        </form>
        
        <div className="login-footer">
          <p>
            Run{' '}
            <code>pnpm foxfang daemon run</code>
            {' '}to get the auto-login link
          </p>
        </div>
      </div>
    </div>
  )
}
