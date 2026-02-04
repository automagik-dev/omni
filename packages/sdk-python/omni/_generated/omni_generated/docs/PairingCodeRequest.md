# PairingCodeRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**phone_number** | **str** | Phone number in international format | 

## Example

```python
from omni_generated.models.pairing_code_request import PairingCodeRequest

# TODO update the JSON string below
json = "{}"
# create an instance of PairingCodeRequest from a JSON string
pairing_code_request_instance = PairingCodeRequest.from_json(json)
# print the JSON string representation of the object
print(PairingCodeRequest.to_json())

# convert the object into a dict
pairing_code_request_dict = pairing_code_request_instance.to_dict()
# create an instance of PairingCodeRequest from a dict
pairing_code_request_from_dict = PairingCodeRequest.from_dict(pairing_code_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


