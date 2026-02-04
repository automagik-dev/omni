# RequestPairingCodeRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**phone_number** | **str** | Phone number in international format | 

## Example

```python
from omni_generated.models.request_pairing_code_request import RequestPairingCodeRequest

# TODO update the JSON string below
json = "{}"
# create an instance of RequestPairingCodeRequest from a JSON string
request_pairing_code_request_instance = RequestPairingCodeRequest.from_json(json)
# print the JSON string representation of the object
print(RequestPairingCodeRequest.to_json())

# convert the object into a dict
request_pairing_code_request_dict = request_pairing_code_request_instance.to_dict()
# create an instance of RequestPairingCodeRequest from a dict
request_pairing_code_request_from_dict = RequestPairingCodeRequest.from_dict(request_pairing_code_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


