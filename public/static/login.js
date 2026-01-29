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
      
      console.log('[Login] Form submitted');
      
      // Hide error message
      if (errorMessage) errorMessage.classList.add('hidden');
      
      // Show loading state
      if (submitText) submitText.classList.add('hidden');
      if (submitLoading) submitLoading.classList.remove('hidden');
      
      // Get form data
      const formData = new FormData(form);
      const data = {
        email: formData.get('email'),
        password: formData.get('password')
      };
      
      console.log('[Login] Data:', { email: data.email, password: '***' });
      
      try {
        console.log('[Login] Sending request...');
        const response = await fetch('/api/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(data)
        });
        
        console.log('[Login] Response status:', response.status);
        const result = await response.json();
        console.log('[Login] Response data:', result);
        
        if (response.ok && result.success) {
          console.log('[Login] Success! Redirecting to dashboard...');
          // Redirect to dashboard
          window.location.href = '/dashboard';
        } else {
          console.error('[Login] Error:', result.error);
          // Show error message
          if (errorMessage) {
            errorMessage.textContent = result.error || 'Une erreur est survenue';
            errorMessage.classList.remove('hidden');
          }
          
          // Reset button state
          if (submitText) submitText.classList.remove('hidden');
          if (submitLoading) submitLoading.classList.add('hidden');
        }
      } catch (error) {
        console.error('[Login] Catch error:', error);
        if (errorMessage) {
          errorMessage.textContent = 'Erreur de connexion au serveur: ' + error.message;
          errorMessage.classList.remove('hidden');
        }
        
        // Reset button state
        if (submitText) submitText.classList.remove('hidden');
        if (submitLoading) submitLoading.classList.add('hidden');
      }
    });
    
    console.log('[Login] Event listener attached successfully');
  }
  
  // Try multiple initialization methods
  if (document.readyState === 'loading') {
    console.log('[Login] Document still loading, waiting for DOMContentLoaded');
    document.addEventListener('DOMContentLoaded', initForm);
  } else {
    console.log('[Login] Document already loaded, initializing immediately');
    initForm();
  }
})();
