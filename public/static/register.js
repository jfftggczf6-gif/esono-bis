// Register form handler
(function() {
  'use strict';
  
  console.log('[Register] Script loaded');
  
  function initForm() {
    const form = document.getElementById('registerForm');
    const errorMessage = document.getElementById('error-message');
    const submitText = document.getElementById('submit-text');
    const submitLoading = document.getElementById('submit-loading');
    
    if (!form) {
      console.error('[Register] Form not found!');
      return;
    }
    
    console.log('[Register] Form found, attaching event listener');
    
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      console.log('[Register] Form submitted');
      
      // Hide error message
      if (errorMessage) errorMessage.classList.add('hidden');
      
      // Show loading state
      if (submitText) submitText.classList.add('hidden');
      if (submitLoading) submitLoading.classList.remove('hidden');
      
      // Get form data
      const formData = new FormData(form);
      const data = {
        name: formData.get('name'),
        email: formData.get('email'),
        password: formData.get('password'),
        country: formData.get('country'),
        status: formData.get('status'),
        user_type: formData.get('user_type')
      };
      
      console.log('[Register] Data:', { ...data, password: '***' });
      
      try {
        console.log('[Register] Sending request...');
        const response = await fetch('/api/register', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(data)
        });
        
        console.log('[Register] Response status:', response.status);
        const result = await response.json();
        console.log('[Register] Response data:', result);
        
        if (response.ok && result.success) {
          console.log('[Register] Success! Redirecting to dashboard...');
          // Redirect to dashboard
          window.location.href = '/dashboard';
        } else {
          console.error('[Register] Error:', result.error);
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
        console.error('[Register] Catch error:', error);
        if (errorMessage) {
          errorMessage.textContent = 'Erreur de connexion au serveur: ' + error.message;
          errorMessage.classList.remove('hidden');
        }
        
        // Reset button state
        if (submitText) submitText.classList.remove('hidden');
        if (submitLoading) submitLoading.classList.add('hidden');
      }
    });
    
    console.log('[Register] Event listener attached successfully');
  }
  
  // Try multiple initialization methods
  if (document.readyState === 'loading') {
    console.log('[Register] Document still loading, waiting for DOMContentLoaded');
    document.addEventListener('DOMContentLoaded', initForm);
  } else {
    console.log('[Register] Document already loaded, initializing immediately');
    initForm();
  }
})();
