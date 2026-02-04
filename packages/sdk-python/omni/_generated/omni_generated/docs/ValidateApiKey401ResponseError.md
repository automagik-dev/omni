# ValidateApiKey401ResponseError


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**code** | **str** |  | 
**message** | **str** |  | 

## Example

```python
from omni_generated.models.validate_api_key401_response_error import ValidateApiKey401ResponseError

# TODO update the JSON string below
json = "{}"
# create an instance of ValidateApiKey401ResponseError from a JSON string
validate_api_key401_response_error_instance = ValidateApiKey401ResponseError.from_json(json)
# print the JSON string representation of the object
print(ValidateApiKey401ResponseError.to_json())

# convert the object into a dict
validate_api_key401_response_error_dict = validate_api_key401_response_error_instance.to_dict()
# create an instance of ValidateApiKey401ResponseError from a dict
validate_api_key401_response_error_from_dict = ValidateApiKey401ResponseError.from_dict(validate_api_key401_response_error_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


