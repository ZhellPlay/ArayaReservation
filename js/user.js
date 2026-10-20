document.addEventListener('DOMContentLoaded', () => {
  initUI();
});

function initUI() {
  const accordions = document.querySelectorAll('.accordion-header');

  accordions.forEach(header => {
    header.addEventListener('click', function() {
      const content = this.nextElementSibling;
      const isActive = this.classList.contains('active');

      accordions.forEach(btn => {
        btn.classList.remove('active');
        btn.nextElementSibling.style.maxHeight = null;
      });

      if (!isActive) {
        this.classList.add('active');
        content.style.maxHeight = content.scrollHeight + "px";
      }
    });
  });
}