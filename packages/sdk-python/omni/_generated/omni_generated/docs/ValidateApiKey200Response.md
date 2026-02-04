# ValidateApiKey200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**data** | [**ValidateApiKey200ResponseData**](ValidateApiKey200ResponseData.md) |  | 

## Example

```python
from omni_generated.models.validate_api_key200_response import ValidateApiKey200Response

# TODO update the JSON string below
json = "{}"
# create an instance of ValidateApiKey200Response from a JSON string
validate_api_key200_response_instance = ValidateApiKey200Response.from_json(json)
# print the JSON string representation of the object
print(ValidateApiKey200Response.to_json())

# convert the object into a dict
validate_api_key200_response_dict = validate_api_key200_response_instance.to_dict()
# create an instance of ValidateApiKey200Response from a dict
validate_api_key200_response_from_dict = ValidateApiKey200Response.from_dict(validate_api_key200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


