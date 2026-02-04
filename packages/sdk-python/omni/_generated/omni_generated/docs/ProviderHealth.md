# ProviderHealth


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**healthy** | **bool** | Whether healthy | 
**latency** | **float** | Latency (ms) | 
**error** | **str** | Error message | 

## Example

```python
from omni_generated.models.provider_health import ProviderHealth

# TODO update the JSON string below
json = "{}"
# create an instance of ProviderHealth from a JSON string
provider_health_instance = ProviderHealth.from_json(json)
# print the JSON string representation of the object
print(ProviderHealth.to_json())

# convert the object into a dict
provider_health_dict = provider_health_instance.to_dict()
# create an instance of ProviderHealth from a dict
provider_health_from_dict = ProviderHealth.from_dict(provider_health_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


