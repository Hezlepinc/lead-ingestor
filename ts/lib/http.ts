import axios from 'axios';

export const http = axios.create({
  validateStatus: () => true,
  maxRedirects: 0,
});


