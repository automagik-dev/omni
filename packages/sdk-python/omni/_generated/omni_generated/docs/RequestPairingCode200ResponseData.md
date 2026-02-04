# RequestPairingCode200ResponseData


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**code** | **str** | Pairing code to enter on phone | 
**phone_number** | **str** | Masked phone number | 
**message** | **str** | Instructions for user | 
**expires_in** | **float** | Seconds until code expires | 

## Example

```python
from omni_generated.models.request_pairing_code200_response_data import RequestPairingCode200ResponseData

# TODO update the JSON string below
json = "{}"
# create an instance of RequestPairingCode200ResponseData from a JSON string
request_pairing_code200_response_data_instance = RequestPairingCode200ResponseData.from_json(json)
# print the JSON string representation of the object
print(RequestPairingCode200ResponseData.to_json())

# convert the object into a dict
request_pairing_code200_response_data_dict = request_pairing_code200_response_data_instance.to_dict()
# create an instance of RequestPairingCode200ResponseData from a dict
request_pairing_code200_response_data_from_dict = RequestPairingCode200ResponseData.from_dict(request_pairing_code200_response_data_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


