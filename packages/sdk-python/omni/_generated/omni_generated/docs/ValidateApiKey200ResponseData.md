# ValidateApiKey200ResponseData


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**valid** | **bool** | Whether the API key is valid | 
**key_prefix** | **str** | Truncated key prefix for identification | 
**key_name** | **str** | Key name (primary or custom name) | 
**scopes** | **List[str]** | Scopes granted to this key | 

## Example

```python
from omni_generated.models.validate_api_key200_response_data import ValidateApiKey200ResponseData

# TODO update the JSON string below
json = "{}"
# create an instance of ValidateApiKey200ResponseData from a JSON string
validate_api_key200_response_data_instance = ValidateApiKey200ResponseData.from_json(json)
# print the JSON string representation of the object
print(ValidateApiKey200ResponseData.to_json())

# convert the object into a dict
validate_api_key200_response_data_dict = validate_api_key200_response_data_instance.to_dict()
# create an instance of ValidateApiKey200ResponseData from a dict
validate_api_key200_response_data_from_dict = ValidateApiKey200ResponseData.from_dict(validate_api_key200_response_data_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


