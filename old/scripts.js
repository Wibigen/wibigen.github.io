// Sélectionne toutes les balises avec la classe "header"
const headers = document.querySelectorAll('.header');

// Récupère le chemin de l'URL actuelle
const currentPage = window.location.pathname.split("/").pop();

// Parcours chaque balise avec la classe "header"
headers.forEach(header => {
  // Sélectionne tous les liens dans cette balise .header
  const links = header.querySelectorAll('a');
  
  // Parcours les liens
  links.forEach(link => {
    // Si l'URL du lien correspond à la page actuelle
    if (link.getAttribute("href") === currentPage || link.getAttribute("href") == "https://wibigen.github.io" {
      // Ajoute la classe "active" au lien
      link.classList.add("active");
    }
  });
});



const apiKey = 'AIzaSyCI-0n3CfEwlbW_t5ROp1k2U1mH0hlwuM4'; // Clé API YouTube
const channelId = 'UCPntukjCpAnk4hoeqCcRgfw'; // ID de ta chaîne YouTube

// Fonction pour obtenir les informations de la chaîne
async function getChannelStats() {
  try {
    // URL de l'API YouTube pour récupérer les données de la chaîne
    const response = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${channelId}&key=${apiKey}`);
    const data = await response.json();

    // Récupérer les statistiques
    const stats = data.items[0].statistics;

    // Afficher les vues et les abonnés
    document.getElementById('Yviews').textContent = stats.viewCount;
    document.getElementById('Ysubscribers').textContent = stats.subscriberCount;
    document.getElementById('Yvideos').textContent = stats.videoCount;

  } catch (error) {
    console.error('Erreur lors de la récupération des données:', error);
  }
}

// Appeler la fonction pour obtenir les données au chargement de la page
window.onload = getChannelStats;
