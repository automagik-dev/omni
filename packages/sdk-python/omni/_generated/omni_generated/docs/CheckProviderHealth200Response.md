# CheckProviderHealth200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**healthy** | **bool** | Whether healthy | 
**latency** | **float** | Latency (ms) | 
**error** | **str** | Error message | 

## Example

```python
from omni_generated.models.check_provider_health200_response import CheckProviderHealth200Response

# TODO update the JSON string below
json = "{}"
# create an instance of CheckProviderHealth200Response from a JSON string
check_provider_health200_response_instance = CheckProviderHealth200Response.from_json(json)
# print the JSON string representation of the object
print(CheckProviderHealth200Response.to_json())

# convert the object into a dict
check_provider_health200_response_dict = check_provider_health200_response_instance.to_dict()
# create an instance of CheckProviderHealth200Response from a dict
check_provider_health200_response_from_dict = CheckProviderHealth200Response.from_dict(check_provider_health200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


