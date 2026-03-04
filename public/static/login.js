// Login form handler - robust cookie + localStorage + URL token
(function() {
  'use strict';
  
  console.log('[Login] Script loaded');
  
  function initForm() {
    var form = document.getElementById('loginForm');
    var errorMessage = document.getElementById('error-message');
    var submitText = document.getElementById('submit-text');
    var submitLoading = document.getElementById('submit-loading');
    
    if (!form) {
      console.error('[Login] Form not found!');
      return;
    }
    
    console.log('[Login] Form found, attaching event listener');
    
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      e.stopPropagation();
      
      if (errorMessage) errorMessage.style.display = 'none';
      if (submitText) submitText.style.display = 'none';
      if (submitLoading) submitLoading.style.display = 'inline-flex';
      
      var formData = new FormData(form);
      var data = {
        email: formData.get('email'),
        password: formData.get('password')
      };
      
      fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data)
      })
      .then(function(response) {
        return response.json().then(function(result) {
          return { ok: response.ok, result: result };
        });
      })
      .then(function(resp) {
        if (resp.ok && resp.result.success) {
          var token = resp.result.token || '';
          
          // Store in localStorage as primary persistence
          if (token) {
            try { localStorage.setItem('auth_token', token); } catch(e) {}
          }
          
          // Set cookie manually as backup (multiple formats for compatibility)
          if (token) {
            document.cookie = 'auth_token=' + token + '; path=/; max-age=604800';
            // Also try with SameSite for HTTPS contexts
            try {
              document.cookie = 'auth_token=' + token + '; path=/; max-age=604800; SameSite=None; Secure';
            } catch(e) {}
          }
          
          // Redirect based on existing role — role is fixed at registration
          var userRole = resp.result.user && resp.result.user.role;
          if (userRole) {
            try { localStorage.setItem('esono_role', userRole); } catch(e) {}
          }
          if (userRole === 'coach') {
            window.location.href = '/coach/dashboard';
          } else {
            window.location.href = '/entrepreneur?token=' + encodeURIComponent(token);
          }
        } else {
          if (errorMessage) {
            errorMessage.textContent = resp.result.error || 'Email ou mot de passe incorrect';
            errorMessage.style.display = 'block';
          }
          if (submitText) submitText.style.display = 'inline-flex';
          if (submitLoading) submitLoading.style.display = 'none';
        }
      })
      .catch(function(error) {
        if (errorMessage) {
          errorMessage.textContent = 'Erreur de connexion au serveur. Veuillez réessayer.';
          errorMessage.style.display = 'block';
        }
        if (submitText) submitText.style.display = 'inline-flex';
        if (submitLoading) submitLoading.style.display = 'none';
        console.error('[Login] Error:', error);
      });
    });
    
    console.log('[Login] Event listener attached successfully');
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initForm);
  } else {
    initForm();
  }
})();
