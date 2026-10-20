const PaymentManager = {
  amount: 0,

  init(nominal) {
    this.amount = nominal;
    this.render();
  },

  getExactAmount() {
    return this.amount;
  },

  formatIDR(value) {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  },

  render() {
    const amountEl = document.getElementById('payment-nominal');
    const infoEl = document.getElementById('payment-instructions');

    if (amountEl) {
      amountEl.textContent = this.formatIDR(this.getExactAmount());
    }

    if (infoEl) {
      infoEl.textContent = "Silakan lakukan pembayaran sesuai dengan nominal di atas.";
    }
  }
};