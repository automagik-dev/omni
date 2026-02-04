# ValidateApiKey401Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**error** | [**ValidateApiKey401ResponseError**](ValidateApiKey401ResponseError.md) |  | 

## Example

```python
from omni_generated.models.validate_api_key401_response import ValidateApiKey401Response

# TODO update the JSON string below
json = "{}"
# create an instance of ValidateApiKey401Response from a JSON string
validate_api_key401_response_instance = ValidateApiKey401Response.from_json(json)
# print the JSON string representation of the object
print(ValidateApiKey401Response.to_json())

# convert the object into a dict
validate_api_key401_response_dict = validate_api_key401_response_instance.to_dict()
# create an instance of ValidateApiKey401Response from a dict
validate_api_key401_response_from_dict = ValidateApiKey401Response.from_dict(validate_api_key401_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


