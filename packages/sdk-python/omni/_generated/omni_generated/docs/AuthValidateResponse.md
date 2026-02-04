# AuthValidateResponse


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**data** | [**ValidateApiKey200ResponseData**](ValidateApiKey200ResponseData.md) |  | 

## Example

```python
from omni_generated.models.auth_validate_response import AuthValidateResponse

# TODO update the JSON string below
json = "{}"
# create an instance of AuthValidateResponse from a JSON string
auth_validate_response_instance = AuthValidateResponse.from_json(json)
# print the JSON string representation of the object
print(AuthValidateResponse.to_json())

# convert the object into a dict
auth_validate_response_dict = auth_validate_response_instance.to_dict()
# create an instance of AuthValidateResponse from a dict
auth_validate_response_from_dict = AuthValidateResponse.from_dict(auth_validate_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


