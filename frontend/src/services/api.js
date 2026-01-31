import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: {
    'Content-Type': 'application/json'
  }
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;

// API functions
export const authAPI = {
  login: (email, password) => api.post('/auth/login', { email, password }),
  register: (email, password, name) => api.post('/auth/register', { email, password, name }),
  getMe: () => api.get('/auth/me'),
  updateSettings: (data) => api.patch('/auth/settings', data),
  disconnectGmail: () => api.post('/auth/gmail/disconnect')
};

export const purchasesAPI = {
  getAll: (params) => api.get('/purchases', { params }),
  getOne: (id) => api.get(`/purchases/${id}`),
  create: (data) => api.post('/purchases', data),
  update: (id, data) => api.patch(`/purchases/${id}`, data),
  delete: (id) => api.delete(`/purchases/${id}`),
  checkPrice: (id) => api.post(`/purchases/${id}/check-price`),
  getPriceHistory: (id) => api.get(`/purchases/${id}/price-history`),
  getStats: () => api.get('/purchases/stats/dashboard')
};

export const claimsAPI = {
  getAll: (params) => api.get('/claims', { params }),
  getOne: (id) => api.get(`/claims/${id}`),
  create: (purchaseId) => api.post('/claims', { purchaseId }),
  generateDocs: (id) => api.post(`/claims/${id}/generate-docs`),
  file: (id, claimNumber) => api.post(`/claims/${id}/file`, { claimNumber }),
  updateStatus: (id, data) => api.patch(`/claims/${id}/status`, data),
  delete: (id) => api.delete(`/claims/${id}`),
  getInstructions: (id) => api.get(`/claims/${id}/instructions`)
};

export const cardsAPI = {
  getAll: () => api.get('/cards'),
  getIssuers: () => api.get('/cards/issuers'),
  create: (data) => api.post('/cards', data),
  update: (id, data) => api.patch(`/cards/${id}`, data),
  delete: (id) => api.delete(`/cards/${id}`),
  getStats: (id) => api.get(`/cards/${id}/stats`)
};

export const subscriptionAPI = {
  getStatus: () => api.get('/subscription/status'),
  getPricing: () => api.get('/subscription/pricing'),
  createCheckout: () => api.post('/subscription/checkout'),
  createPortal: () => api.post('/subscription/portal'),
  cancel: () => api.post('/subscription/cancel'),
  resume: () => api.post('/subscription/resume')
};

export const emailAPI = {
  getStatus: () => api.get('/email/status'),
  sync: () => api.post('/email/sync'),
  getSyncStatus: (syncId) => api.get(`/email/sync/${syncId}`),
  getSyncHistory: () => api.get('/email/sync-history'),
  getRetailers: () => api.get('/email/retailers')
};

export const notificationsAPI = {
  getAll: (params) => api.get('/notifications', { params }),
  markRead: (id) => api.patch(`/notifications/${id}/read`),
  markAllRead: () => api.post('/notifications/mark-all-read'),
  delete: (id) => api.delete(`/notifications/${id}`)
};
