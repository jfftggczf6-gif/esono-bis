// Login form handler
(function() {
  'use strict';
  
  console.log('[Login] Script loaded');
  
  function initForm() {
    const form = document.getElementById('loginForm');
    const errorMessage = document.getElementById('error-message');
    const submitText = document.getElementById('submit-text');
    const submitLoading = document.getElementById('submit-loading');
    
    if (!form) {
      console.error('[Login] Form not found!');
      return;
    }
    
    console.log('[Login] Form found, attaching event listener');
    
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (errorMessage) errorMessage.classList.add('hidden');
      if (submitText) submitText.classList.add('hidden');
      if (submitLoading) submitLoading.classList.remove('hidden');
      
      const formData = new FormData(form);
      const data = {
        email: formData.get('email'),
        password: formData.get('password')
      };
      
      try {
        const response = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        if (response.ok && result.success) {
          // Store token in localStorage AND set cookie manually as backup
          if (result.token) {
            localStorage.setItem('auth_token', result.token);
            document.cookie = 'auth_token=' + result.token + '; path=/; max-age=604800; SameSite=None; Secure';
          }
          window.location.href = '/entrepreneur?token=' + encodeURIComponent(result.token || '');
        } else {
          if (errorMessage) {
            errorMessage.textContent = result.error || 'Une erreur est survenue';
            errorMessage.classList.remove('hidden');
          }
          if (submitText) submitText.classList.remove('hidden');
          if (submitLoading) submitLoading.classList.add('hidden');
        }
      } catch (error) {
        if (errorMessage) {
          errorMessage.textContent = 'Erreur de connexion au serveur: ' + error.message;
          errorMessage.classList.remove('hidden');
        }
        if (submitText) submitText.classList.remove('hidden');
        if (submitLoading) submitLoading.classList.add('hidden');
      }
    });
    
    console.log('[Login] Event listener attached successfully');
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initForm);
  } else {
    initForm();
  }
})();
