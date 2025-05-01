import requests
import json
from datetime import datetime

class BlazeAPI:
    def __init__(self):
        self.base_url = "https://blaze.com"
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36"
        }
        self.session = requests.Session()
    
    def get_last_doubles(self):
        """
        Obtém os últimos resultados do jogo Double da Blaze
        
        Returns:
            dict: Dicionário com os resultados recentes, incluindo cor, valor e data/hora
        """
        try:
            response = self.session.get(
                f"{self.base_url}/api/roulette_games/recent", 
                headers=self.headers
            )
            
            if response.status_code == 200:
                data = response.json()
                
                # Formata os resultados para um formato mais amigável
                results = {
                    "items": [
                        {
                            "color": "branco" if item["color"] == 0 else "vermelho" if item["color"] == 1 else "preto",
                            "value": item["roll"],
                            "created_at": datetime.strptime(
                                item["created_at"], 
                                "%Y-%m-%dT%H:%M:%S.%fZ"
                            ).strftime("%Y-%m-%d %H:%M:%S")
                        }
                        for item in data
                    ]
                }
                return results
            else:
                print(f"Erro ao obter resultados: {response.status_code}")
                return {"items": []}
        except Exception as e:
            print(f"Erro ao conectar com a API da Blaze: {str(e)}")
            return {"items": []}
    
    def check_win(self, predicted_time, tolerance_minutes=1):
        """
        Verifica se houve um resultado branco próximo ao horário previsto
        
        Args:
            predicted_time (str): Horário previsto no formato "HH:MM"
            tolerance_minutes (int): Tolerância em minutos para considerar acerto
            
        Returns:
            dict: Informações sobre o acerto ou erro da previsão
        """
        try:
            # Obtém os últimos resultados
            results = self.get_last_doubles()
            
            if not results["items"]:
                return {
                    "success": False,
                    "message": "Não foi possível obter resultados recentes"
                }
            
            # Converte o horário previsto para datetime
            today = datetime.now().strftime("%Y-%m-%d")
            predicted_datetime = datetime.strptime(f"{today} {predicted_time}", "%Y-%m-%d %H:%M")
            
            # Procura por resultados brancos próximos ao horário previsto
            white_hits = []
            
            for item in results["items"]:
                if item["color"] == "branco":
                    result_datetime = datetime.strptime(item["created_at"], "%Y-%m-%d %H:%M:%S")
                    
                    # Calcula a diferença em minutos
                    diff_minutes = abs((result_datetime - predicted_datetime).total_seconds() / 60)
                    
                    if diff_minutes <= tolerance_minutes:
                        white_hits.append({
                            "value": item["value"],
                            "time": item["created_at"],
                            "diff_minutes": round(diff_minutes, 2)
                        })
            
            if white_hits:
                return {
                    "success": True,
                    "message": f"Acerto! Branco(s) encontrado(s) próximo ao horário previsto",
                    "hits": white_hits
                }
            else:
                return {
                    "success": False,
                    "message": "Nenhum branco encontrado próximo ao horário previsto"
                }
                
        except Exception as e:
            return {
                "success": False,
                "message": f"Erro ao verificar acerto: {str(e)}"
            }

# Exemplo de uso
if __name__ == "__main__":
    api = BlazeAPI()
    results = api.get_last_doubles()
    print(json.dumps(results, indent=2, ensure_ascii=False))
    
    # Exemplo de verificação de acerto
    check = api.check_win("14:30", tolerance_minutes=2)
    print(json.dumps(check, indent=2, ensure_ascii=False))
